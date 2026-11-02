const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    Browsers,
    makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./database/session');
    
    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })),
        },
        browser: Browsers.ubuntu('Chrome')
    });

    if (!sock.authState.creds.registered) {
        const phoneNumber = await question('Masukan Nomor WhatsApp Anda (Awali dengan 62): ');
        setTimeout(async () => {
            let code = await sock.requestPairingCode(phoneNumber.trim());
            code = code?.match(/.{1,4}/g)?.join("-") || code;
            console.log(`\n========================================`);
            console.log(`KODE PAIRING ANDA: ${code}`);
            console.log(`========================================\n`);
        }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) {
                startBot();
            } else {
                console.log('Sesi keluar. Hapus folder database/session untuk pairing ulang.');
            }
        } else if (connection === 'open') {
            console.log('✨ BERHASIL TERHUBUNG KE WHATSAPP! Bot aktif.');
        }
    });

    sock.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            const mek = chatUpdate.messages[0];
            if (!mek.message) return;
            if (mek.key.fromMe) return;

            const mtype = Object.keys(mek.message)[0];
            const body = (mtype === 'conversation') ? mek.message.conversation :
                         (mtype === 'extendedTextMessage') ? mek.message.extendedTextMessage.text : '';
            
            const from = mek.key.remoteJid;
            const isGroup = from.endsWith('@g.us');
            const pushname = mek.pushName || 'Tanpa Nama';

            if (!body.startsWith('.')) return;

            const args = body.slice(1).trim().split(/ +/);
            const command = args.shift().toLowerCase();
            const q = args.join(' ');

            switch (command) {
                case 'menu':
                case 'help':
                    let menuText = `🤖 *WHATSAPP BOT PUBLIK* 🤖\n`;
                    menuText += `Halo *${pushname}*, bot aktif di grup & chat pribadi!\n\n`;
                    menuText += `📂 *[ MENU PERINTAH ]*\n` +
                                `• .menu\n` +
                                `• .ping\n` +
                                `• .ai [pertanyaan]\n` +
                                `• .sticker\n\n` +
                                `Ketik perintah dengan awalan titik (.)`;
                    await sock.sendMessage(from, { text: menuText }, { quoted: mek });
                    break;

                case 'ping':
                    await sock.sendMessage(from, { text: 'Pong! 🏓 Bot merespons dengan cepat.' }, { quoted: mek });
                    break;

                case 'ai':
                    if (!q) return sock.sendMessage(from, { text: 'Contoh: .ai Halo bot' }, { quoted: mek });
                    await sock.sendMessage(from, { text: `🤖 *AI Assistant:* Halo! Pertanyaan Anda: "${q}"` }, { quoted: mek });
                    break;

                default:
                    await sock.sendMessage(from, { text: `Perintah .${command} tidak ditemukan. Ketik *.menu*.` }, { quoted: mek });
                    break;
            }
        } catch (err) {
            console.error('Error:', err);
        }
    });
}

startBot();
  
