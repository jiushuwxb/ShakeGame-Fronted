# 希捷摇一摇互动游戏前端

原生 HTML5 + CSS3 + JavaScript 前端，手机端和大屏端页面资源已分目录管理。

## 目录结构

```text
shake-fronted/
  user/
    index.html
    app.js
    styles.css
    config.js
  screen/
    index.html
    screen.js
    styles.css
    config.js
```

## 页面

- `user/index.html`: 手机端，微信授权后加入活动，监听加速度传感器并实时上报摇动次数。
- `screen/index.html`: 大屏端，展示二维码、倒计时、前 10 名实时排名，并提供现场控制按钮。

## 配置

手机端和大屏端各自有一份 `config.js`。如果部署在同一套环境，建议保持两份内容一致：

```js
window.SHAKE_CONFIG = {
  apiBaseUrl: 'https://api.example.com',
  wsUrl: 'wss://api.example.com',
  questionnaireUrl: 'https://www.wjx.cn/vm/your-questionnaire.aspx',
  activityTitle: '希捷极速传输挑战赛',
  brandLine: 'Seagate Data Transfer Challenge'
};
```

## 本地预览

可使用任意静态服务器，例如：

```bash
npx http-server . -p 5173
```

然后访问：

- 手机端：`http://localhost:5173/user/index.html?mock=1`
- 大屏端：`http://localhost:5173/screen/index.html?adminToken=change-me`

## 部署说明

1. 将本目录作为静态站点部署到 H5 域名，建议启用 HTTPS。
2. 将 `user/config.js` 和 `screen/config.js` 的 `apiBaseUrl` 改为后端公网 HTTPS 地址。
3. 将两份 `config.js` 的 `wsUrl` 改为后端公网 WebSocket 地址，HTTPS 对应 `wss://`。
4. 将两份 `config.js` 的 `questionnaireUrl` 改为正式问卷星链接。
5. 大屏页 URL 中可临时携带 `adminToken`，也可以打开页面后手动输入。

## 注意事项

- iOS 13+ 需要用户点击“开启摇一摇权限”后才允许读取传感器。
- 微信授权只有在公众号网页授权域名、后端 `WECHAT_APP_ID` 和 `WECHAT_APP_SECRET` 正确配置后才会真实获取头像昵称。
- 未配置微信授权或访问 `?mock=1` 时，手机端会自动使用现场测试玩家身份，便于本地联调。
