# TODO - 碧潭商店街 抄表管理系統

- [x] 依原始表格（4月瓦斯抄表）建立可線上填寫的數位抄表系統
- [x] 自動計算用量（本月-上月）與估算金額（可設定水/電/瓦斯單價）
- [x] 未填 / 異常（度數倒退、用量偏高）提醒
- [x] 多期別切換與建立下一期（自動帶入上月度數）、每列歷史紀錄查詢
- [x] 匯出 CSV / Excel、列印、JSON 備份匯出還原
- [x] 管理抄表項目（新增/編輯/刪除門市與錶號）
- [x] 本地測試（Playwright headless）：填寫、單價設定、建立下一期、篩選皆正常運作

## 待使用者確認事項
- [ ] 初始資料為表格轉檔，請於「管理抄表項目」逐筆核對錶號與度數是否正確

## 雲端帳號設定（一次性，需使用者完成）

登入畫面已加上「註冊」功能，新帳號需管理員（總管理員＝目前唯一帳號 `wu8858009`）審核通過才能登入。
因為要讓管理員在任何裝置上都能看到別人送出的註冊申請，帳號資料改存在 Firebase（Authentication + Firestore，
免費 Spark 方案額度內），需要先完成以下一次性設定：

1. 到 https://console.firebase.google.com 建立新專案 → 加入一個「Web 應用程式」，把取得的設定值
   （apiKey / authDomain / projectId / storageBucket / messagingSenderId / appId）填入專案根目錄的
   `firebase-config.js`。
2. 左側選單 Authentication → Sign-in method → 啟用「電子郵件/密碼」。
3. 左側選單 Firestore Database → 建立資料庫，接著到「規則」分頁，貼上並發布以下內容：

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       function isAdmin() {
         return request.auth != null &&
           exists(/databases/$(database)/documents/users/$(request.auth.uid)) &&
           get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
       }
       match /users/{userId} {
         allow get: if request.auth != null && (request.auth.uid == userId || isAdmin());
         allow list: if isAdmin();
         allow create: if request.auth != null && request.auth.uid == userId
                       && request.resource.data.role == 'staff'
                       && request.resource.data.status == 'pending';
         allow update, delete: if isAdmin();
       }
     }
   }
   ```

4. 建立第一個（也是唯一手動建立的）管理員帳號：
   - Authentication → Users → 新增使用者，Email 填 `wu8858009@bpt.local`，**密碼請自訂一組新的強密碼**
     （不要沿用舊版程式裡寫死過的密碼——這個 repo 是公開的，舊密碼等於已經外流，務必換一組新的，
     且不要跟你其他帳號共用）。
   - 複製新使用者的 UID，到 Firestore Database → `users` collection → 新增文件，文件 ID 貼上該 UID，
     欄位填：`username`（字串）= `wu8858009`、`role`（字串）= `admin`、`status`（字串）= `approved`。
   - 之後其他人一律透過畫面上的「註冊」功能申請帳號，登入畫面右上角（登入後可見）的「帳號審核」
     按鈕可以核准/拒絕/停權。

### 為什麼這樣寫比較安全
- `wu8858009` 這個「總管理員」身分**只存在於 Firebase**（Authentication 的帳密 + Firestore
  `users` 文件的 `role: admin`），完全不會出現在程式碼或 GitHub repo 裡，這樣即使 repo 公開，
  別人也看不到密碼、也無法冒充。
- Firestore 安全規則規定：一般使用者註冊時只能建立 `role: staff`、`status: pending` 的文件
  （見上面規則裡的 `allow create`），沒有任何管道能自己把自己升級成 `admin` 或直接把
  `status` 改成 `approved`——只有 `role: admin` 的帳號才能核准別人（`allow update, delete: if isAdmin()`）。
  所以就算有人知道你的帳號叫 `wu8858009`，也無法偽造出另一個管理員身分。
- 真正該保護好的只剩「這組密碼本身」和「你登入 Firebase Console 的 Google 帳號」，建議都開啟
  兩步驟驗證，密碼也不要與其他服務共用。

完成以上設定後，原本寫死在程式碼裡的帳密就會失效，一律以 Firebase 上的帳號為準。
