const { spawn, fork } = require('child_process');
const path = require('path');
const fs = require('fs');

console.clear();
console.log('=============================================================');
console.log('       🎵 STARTING SYNCTUNES ONLINE PARTY SERVER... 🎵');
console.log('=============================================================\n');

// 1. Start Express + Socket.IO Server
const serverProcess = fork(path.join(__dirname, 'server.js'), [], {
  stdio: 'inherit'
});

// 2. Start Cloudflare Tunnel for Free Public HTTPS URL (No Hotspot Needed)
const cloudflaredBin = path.join(__dirname, '..', 'tools', 'cloudflared.exe');

if (!fs.existsSync(cloudflaredBin)) {
  console.error('[Error] cloudflared.exe not found at:', cloudflaredBin);
  process.exit(1);
}

const tunnel = spawn(cloudflaredBin, ['tunnel', '--url', 'http://localhost:3000']);

let foundUrl = false;

function handleOutput(data) {
  const str = data.toString();
  const match = str.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
  if (match && !foundUrl) {
    foundUrl = true;
    const publicUrl = match[0];

    // Save to file for easy reference
    fs.writeFileSync(path.join(__dirname, 'ONLINE_LINK.txt'), publicUrl, 'utf8');

    console.log('\n=============================================================');
    console.log('  🎉 SUCCESS! YOUR SERVER IS NOW LIVE ON THE INTERNET! 🎉');
    console.log('=============================================================');
    console.log('\n  👉 SHARE THIS LINK WITH YOUR FRIENDS (NO HOTSPOT NEEDED):');
    console.log(`\n     \x1b[32m\x1b[1m${publicUrl}\x1b[0m\n`);
    console.log('=============================================================');
    console.log('  📱 Friends can open this on any Mobile Data (Jio/Airtel/etc.)');
    console.log('  💻 You can also use: http://localhost:3000 on this PC');
    console.log('  📄 The link is also saved in: ONLINE_LINK.txt');
    console.log('=============================================================\n');
  }
}

tunnel.stderr.on('data', handleOutput);
tunnel.stdout.on('data', handleOutput);

tunnel.on('close', (code) => {
  console.log(`[Cloudflare Tunnel closed with code ${code}]`);
});

process.on('SIGINT', () => {
  tunnel.kill();
  serverProcess.kill();
  process.exit(0);
});
