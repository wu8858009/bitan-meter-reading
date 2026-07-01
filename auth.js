/*
  帳號登入 / 註冊 / 管理員審核。
  以 Firebase Authentication（email/password）+ Firestore（users collection）取代原本寫死在
  app.js 的帳密比對，讓註冊申請與審核狀態可以跨裝置同步。
  帳號登入沿用「帳號＋密碼」的操作習慣，內部用 `${username}@bpt.local` 對應成 Firebase Auth 需要的 email 格式。

  所有「登入後要不要放行」的判斷都集中在 onAuthStateChanged 這一個地方處理（包含重新整理頁面時
  Firebase 既有 session 的還原），避免 handleLogin 跟監聽器各自呼叫 unlockApp/bootstrap 造成
  app.js 的事件監聽被重複註冊。
*/

const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null; // { uid, username, role }
let ignoreNextAuthChange = false; // 註冊流程會自動登入又登出，中間的狀態變化不需要處理

function usernameToEmail(username) {
  return `${username.trim().toLowerCase()}@bpt.local`;
}

function showLoginView() {
  document.getElementById('registerGate').style.display = 'none';
  document.getElementById('loginGate').style.display = 'flex';
}

function showRegisterView() {
  document.getElementById('loginGate').style.display = 'none';
  document.getElementById('registerGate').style.display = 'flex';
  document.getElementById('registerError').textContent = '';
  document.getElementById('registerSuccess').textContent = '';
}

function unlockApp() {
  document.getElementById('loginGate').style.display = 'none';
  document.getElementById('registerGate').style.display = 'none';
  document.getElementById('appRoot').style.display = '';
  document.getElementById('currentUserLabel').textContent = `目前登入：${currentUser.username}`;
  document.getElementById('btnUserApproval').style.display = currentUser.role === 'admin' ? '' : 'none';
  bootstrap();
}

async function handleLogin(username, password) {
  const loginError = document.getElementById('loginError');
  loginError.textContent = '';
  try {
    await auth.signInWithEmailAndPassword(usernameToEmail(username), password);
  } catch (err) {
    loginError.textContent = '帳號或密碼錯誤，請再試一次';
  }
  // 帳號核准狀態的判斷與畫面解鎖統一交給 onAuthStateChanged 處理
}

async function handleRegister(username, password, passwordConfirm) {
  const registerError = document.getElementById('registerError');
  const registerSuccess = document.getElementById('registerSuccess');
  registerError.textContent = '';
  registerSuccess.textContent = '';

  if (!username) {
    registerError.textContent = '請輸入帳號';
    return;
  }
  if (password.length < 6) {
    registerError.textContent = '密碼至少需要 6 個字元';
    return;
  }
  if (password !== passwordConfirm) {
    registerError.textContent = '兩次輸入的密碼不一致';
    return;
  }

  ignoreNextAuthChange = true;
  let cred;
  try {
    cred = await auth.createUserWithEmailAndPassword(usernameToEmail(username), password);
  } catch (err) {
    ignoreNextAuthChange = false;
    if (err.code === 'auth/email-already-in-use') {
      registerError.textContent = '此帳號已被使用，請更換帳號';
    } else if (err.code === 'auth/invalid-email') {
      registerError.textContent = '帳號格式不正確，請避免使用特殊符號';
    } else {
      registerError.textContent = '註冊失敗，請稍後再試';
    }
    return;
  }

  try {
    await db.collection('users').doc(cred.user.uid).set({
      username: username,
      role: 'staff',
      status: 'pending',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } finally {
    await auth.signOut();
    ignoreNextAuthChange = false;
  }

  document.getElementById('registerForm').reset();
  registerSuccess.textContent = '註冊成功，請等待管理員審核後再登入';
}

/* ---------------- 管理員審核面板 ---------------- */

const STATUS_LABEL = { pending: '待審核', approved: '已核准', rejected: '已拒絕' };

async function openUserApprovalModal() {
  openModal('userApprovalModal');
  await renderUserApprovalList();
}

async function renderUserApprovalList() {
  const wrap = document.getElementById('userApprovalTableWrap');
  wrap.textContent = '載入中…';

  const snapshot = await db.collection('users').get();
  const rows = [];
  snapshot.forEach((doc) => rows.push({ id: doc.id, ...doc.data() }));
  rows.sort((a, b) => (a.username || '').localeCompare(b.username || ''));

  const table = document.createElement('table');
  table.className = 'meter-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>帳號</th><th>角色</th><th>狀態</th><th>操作</th></tr>';
  const tbody = document.createElement('tbody');

  rows.forEach((row) => {
    const tr = document.createElement('tr');
    const roleLabel = row.role === 'admin' ? '管理員' : '一般員工';
    const actions = [];
    if (row.role !== 'admin') {
      if (row.status === 'pending') {
        actions.push(['核准', 'approved'], ['拒絕', 'rejected']);
      } else if (row.status === 'approved') {
        actions.push(['停權', 'rejected']);
      } else if (row.status === 'rejected') {
        actions.push(['重新核准', 'approved']);
      }
    }
    const actionsHtml = actions
      .map(([label, status]) => `<button type="button" class="btn" data-uid="${row.id}" data-status="${status}">${label}</button>`)
      .join(' ');
    tr.innerHTML = `<td>${row.username || ''}</td><td>${roleLabel}</td><td>${STATUS_LABEL[row.status] || row.status}</td><td>${actionsHtml}</td>`;
    tbody.appendChild(tr);
  });

  table.appendChild(thead);
  table.appendChild(tbody);
  wrap.innerHTML = '';
  wrap.appendChild(table);

  wrap.querySelectorAll('button[data-uid]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await db.collection('users').doc(btn.dataset.uid).update({ status: btn.dataset.status });
      toast('帳號狀態已更新');
      renderUserApprovalList();
    });
  });
}

/* ---------------- 登入狀態變化（含頁面重新整理時還原 session） ---------------- */

auth.onAuthStateChanged(async (user) => {
  if (ignoreNextAuthChange) return;

  if (user && !currentUser) {
    const loginError = document.getElementById('loginError');
    let data = null;
    try {
      const doc = await db.collection('users').doc(user.uid).get();
      data = doc.exists ? doc.data() : null;
    } catch (err) {
      data = null;
    }

    if (data && data.status === 'approved') {
      currentUser = { uid: user.uid, username: data.username, role: data.role };
      unlockApp();
    } else {
      if (data && data.status === 'pending') {
        loginError.textContent = '帳號審核中，請等待管理員核准';
      } else if (data && data.status === 'rejected') {
        loginError.textContent = '帳號申請已被拒絕，請聯絡管理員';
      } else {
        loginError.textContent = '帳號或密碼錯誤，請再試一次';
      }
      await auth.signOut();
    }
    return;
  }

  if (!user && currentUser) {
    // 登出（或帳號被中途停權）：重新整理頁面回到最初狀態，避免重複註冊 app.js 的事件監聽
    location.reload();
  }
});

/* ---------------- 初始化 ---------------- */

function initGate() {
  auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);

  document.getElementById('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    handleLogin(username, password);
  });

  document.getElementById('registerForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const username = document.getElementById('registerUsername').value.trim();
    const password = document.getElementById('registerPassword').value;
    const passwordConfirm = document.getElementById('registerPasswordConfirm').value;
    handleRegister(username, password, passwordConfirm);
  });

  document.getElementById('btnShowRegister').addEventListener('click', showRegisterView);
  document.getElementById('btnShowLogin').addEventListener('click', showLoginView);

  document.getElementById('btnUserApproval').addEventListener('click', openUserApprovalModal);
  document.getElementById('btnUserApprovalClose').addEventListener('click', () => closeModal('userApprovalModal'));
  document.getElementById('btnLogout').addEventListener('click', () => auth.signOut());

  document.getElementById('loginUsername').focus();
}

document.addEventListener('DOMContentLoaded', initGate);
