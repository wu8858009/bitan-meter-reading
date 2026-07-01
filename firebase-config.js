/*
  Firebase 專案設定。
  請至 https://console.firebase.google.com 建立專案 → 新增「Web 應用程式」，
  把取得的設定值貼到下面（apiKey 等資訊屬於公開資訊，安全性由 Firestore 規則把關，
  不需要當成密碼隱藏）。詳細步驟見 TODO.md「雲端帳號設定」章節。
*/
const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT_ID.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID',
};

firebase.initializeApp(firebaseConfig);
