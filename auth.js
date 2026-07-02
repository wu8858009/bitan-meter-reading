/*
  帳號登入 / 註冊 / 管理員審核。
  帳號資料改存在瀏覽器本機（localStorage），不需要任何雲端服務設定即可使用。
  代價是：帳號資料只存在建立帳號當下所用的那台裝置／瀏覽器裡，換一台電腦或清除瀏覽器資料
  都需要重新註冊；管理員審核也只能在同一台裝置上看到申請。

  管理員帳號固定為 wu8858009，但密碼不寫死在程式碼裡（這個 repo 是公開的，寫在程式碼裡等於
  密碼外流）——第一次開啟頁面、瀏覽器裡還沒有任何帳號時，會顯示「設定管理員密碼」畫面，由
  使用者自行輸入密碼，雜湊後存進 localStorage。其他人一律透過畫面上的「註冊」功能申請帳號，
  待管理員在「帳號審核」核准後才能登入。
*/

const USERS_KEY = 'bpt_auth_users';
const SESSION_KEY = 'bpt_auth_session';

const ADMIN_USERNAME = 'wu8858009';

let currentUser = null; // { username, role }

function isAdmin() {
  return !!currentUser && currentUser.role === 'admin';
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function normalizeUsername(username) {
  return username.trim().toLowerCase();
}

function loadUsers() {
  try {
    const raw = JSON.parse(localStorage.getItem(USERS_KEY));
    return Array.isArray(raw) ? raw : [];
  } catch (err) {
    return [];
  }
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function showSetupView() {
  document.getElementById('loginGate').style.display = 'none';
  document.getElementById('registerGate').style.display = 'none';
  document.getElementById('setupGate').style.display = 'flex';
  document.getElementById('setupPassword').focus();
}

function showLoginView() {
  document.getElementById('setupGate').style.display = 'none';
  document.getElementById('registerGate').style.display = 'none';
  document.getElementById('loginGate').style.display = 'flex';
  document.getElementById('loginUsername').focus();
}

function showRegisterView() {
  document.getElementById('loginGate').style.display = 'none';
  document.getElementById('registerGate').style.display = 'flex';
  document.getElementById('registerError').textContent = '';
  document.getElementById('registerSuccess').textContent = '';
  document.getElementById('registerUsername').focus();
}

async function handleSetupAdmin(password, passwordConfirm) {
  const setupError = document.getElementById('setupError');
  setupError.textContent = '';

  if (password.length < 6) {
    setupError.textContent = '密碼至少需要 6 個字元';
    return;
  }
  if (password !== passwordConfirm) {
    setupError.textContent = '兩次輸入的密碼不一致';
    return;
  }

  const users = loadUsers();
  users.push({
    username: ADMIN_USERNAME,
    passwordHash: await sha256Hex(password),
    role: 'admin',
    status: 'approved',
    createdAt: Date.now(),
  });
  saveUsers(users);

  document.getElementById('setupForm').reset();
  showLoginView();
  document.getElementById('loginUsername').value = ADMIN_USERNAME;
  document.getElementById('loginPassword').focus();
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

  const key = normalizeUsername(username);
  const users = loadUsers();
  const user = users.find((u) => u.username === key);

  if (!user || user.passwordHash !== (await sha256Hex(password))) {
    loginError.textContent = '帳號或密碼錯誤，請再試一次';
    return;
  }
  if (user.status === 'pending') {
    loginError.textContent = '帳號審核中，請等待管理員核准';
    return;
  }
  if (user.status === 'rejected') {
    loginError.textContent = '帳號申請已被拒絕，請聯絡管理員';
    return;
  }

  currentUser = { username: user.username, role: user.role };
  sessionStorage.setItem(SESSION_KEY, user.username);
  unlockApp();
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

  const key = normalizeUsername(username);
  const users = loadUsers();
  if (users.some((u) => u.username === key)) {
    registerError.textContent = '此帳號已被使用，請更換帳號';
    return;
  }

  users.push({
    username: key,
    passwordHash: await sha256Hex(password),
    role: 'staff',
    status: 'pending',
    createdAt: Date.now(),
  });
  saveUsers(users);

  document.getElementById('registerForm').reset();
  registerSuccess.textContent = '註冊成功，請等待管理員審核後再登入';
}

/* ---------------- 管理員審核面板 ---------------- */

const STATUS_LABEL = { pending: '待審核', approved: '已核准', rejected: '已拒絕' };

async function openUserApprovalModal() {
  openModal('userApprovalModal');
  renderUserApprovalList();
}

function renderUserApprovalList() {
  const wrap = document.getElementById('userApprovalTableWrap');

  const rows = loadUsers().slice().sort((a, b) => (a.username || '').localeCompare(b.username || ''));

  const table = document.createElement('table');
  table.className = 'account-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>帳號</th><th>角色</th><th>狀態</th><th>操作</th></tr>';
  const tbody = document.createElement('tbody');

  rows.forEach((row) => {
    const tr = document.createElement('tr');
    const roleLabel = row.role === 'admin' ? '管理員' : '抄表員';
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
      .map(([label, status]) => `<button type="button" class="btn" data-username="${row.username}" data-status="${status}">${label}</button>`)
      .join(' ');
    tr.innerHTML = `<td>${row.username || ''}</td><td>${roleLabel}</td><td>${STATUS_LABEL[row.status] || row.status}</td><td>${actionsHtml}</td>`;
    tbody.appendChild(tr);
  });

  table.appendChild(thead);
  table.appendChild(tbody);
  wrap.innerHTML = '';
  wrap.appendChild(table);

  wrap.querySelectorAll('button[data-username]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const users = loadUsers();
      const target = users.find((u) => u.username === btn.dataset.username);
      if (target) {
        target.status = btn.dataset.status;
        saveUsers(users);
      }
      toast('帳號狀態已更新');
      renderUserApprovalList();
    });
  });
}

/* ---------------- 表單體驗：按 Enter 跳到下一個欄位 ---------------- */

function focusNextOnEnter(inputIds) {
  const inputs = inputIds.map((id) => document.getElementById(id));
  inputs.forEach((input, idx) => {
    if (idx === inputs.length - 1) return; // 最後一個欄位讓 Enter 照常送出表單
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      inputs[idx + 1].focus();
    });
  });
}

/* ---------------- 初始化（含頁面重新整理時還原 session） ---------------- */

async function initGate() {
  focusNextOnEnter(['setupPassword', 'setupPasswordConfirm']);
  focusNextOnEnter(['loginUsername', 'loginPassword']);
  focusNextOnEnter(['registerUsername', 'registerPassword', 'registerPasswordConfirm']);

  document.getElementById('setupForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const password = document.getElementById('setupPassword').value;
    const passwordConfirm = document.getElementById('setupPasswordConfirm').value;
    handleSetupAdmin(password, passwordConfirm);
  });

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
  document.getElementById('btnLogout').addEventListener('click', () => {
    sessionStorage.removeItem(SESSION_KEY);
    location.reload();
  });

  const savedUsername = sessionStorage.getItem(SESSION_KEY);
  if (savedUsername) {
    const user = loadUsers().find((u) => u.username === savedUsername && u.status === 'approved');
    if (user) {
      currentUser = { username: user.username, role: user.role };
      unlockApp();
      return;
    }
    sessionStorage.removeItem(SESSION_KEY);
  }

  if (loadUsers().length === 0) {
    showSetupView();
    return;
  }

  showLoginView();
}

document.addEventListener('DOMContentLoaded', initGate);
