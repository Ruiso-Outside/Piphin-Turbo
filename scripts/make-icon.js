// Desenha o ícone do Piphin Turbo: icons/turbo.png (256). Uso: npm run icon (usa o Electron do Piphin Hub).
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL("about:blank");
  const b64 = await win.webContents.executeJavaScript(`(() => {
    const s = 256, c = document.createElement("canvas"); c.width = c.height = s;
    const g = c.getContext("2d");
    g.beginPath(); g.roundRect(8, 8, 240, 240, 56);
    const bg = g.createLinearGradient(0, 0, s, s); bg.addColorStop(0, "#0c1d3d"); bg.addColorStop(1, "#0b0a12");
    g.fillStyle = bg; g.fill();
    g.lineWidth = 3; g.strokeStyle = "rgba(59,130,246,.6)"; g.stroke();
    const grad = g.createLinearGradient(40, 200, 216, 60); grad.addColorStop(0, "#2563eb"); grad.addColorStop(.6, "#3b82f6"); grad.addColorStop(1, "#22d3ee");
    // velocímetro
    g.save(); g.shadowColor = "#3b82f6"; g.shadowBlur = 20;
    g.lineCap = "round"; g.lineWidth = 18; g.strokeStyle = "rgba(255,255,255,.12)";
    g.beginPath(); g.arc(128, 150, 80, Math.PI * 0.8, Math.PI * 2.2); g.stroke();
    g.strokeStyle = grad; g.beginPath(); g.arc(128, 150, 80, Math.PI * 0.8, Math.PI * 1.9); g.stroke();
    g.restore();
    // ponteiro
    g.save(); g.translate(128, 150); g.rotate(-0.55); g.shadowColor = "#22d3ee"; g.shadowBlur = 14; g.fillStyle = "#e0f2fe";
    g.beginPath(); g.moveTo(-7, 0); g.lineTo(0, -70); g.lineTo(7, 0); g.closePath(); g.fill();
    g.beginPath(); g.arc(0, 0, 13, 0, Math.PI * 2); g.fill(); g.restore();
    // raio pequeno embaixo
    g.save(); g.fillStyle = "#facc15"; g.shadowColor = "#facc15"; g.shadowBlur = 12;
    g.beginPath(); g.moveTo(134, 186); g.lineTo(116, 214); g.lineTo(128, 214); g.lineTo(122, 236); g.lineTo(142, 204); g.lineTo(130, 204); g.closePath(); g.fill(); g.restore();
    return c.toDataURL("image/png").split(",")[1];
  })()`);
  fs.mkdirSync(path.join(__dirname, "..", "icons"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "..", "icons", "turbo.png"), Buffer.from(b64, "base64"));
  console.log("ícone: icons/turbo.png");
  app.quit();
});
