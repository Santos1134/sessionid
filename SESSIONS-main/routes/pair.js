const { 
    giftedId,
    removeFile,
    generateRandomCode
} = require('../gift');
const zlib = require('zlib');
const express = require('express');
const fs = require('fs');
const path = require('path');
let router = express.Router();
const pino = require("pino");
const { sendButtons } = require('gifted-btns');
const {
    default: giftedConnect,
    useMultiFileAuthState,
    delay,
    downloadContentFromMessage, 
    generateWAMessageFromContent,
    normalizeMessageContent,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    Browsers
} = require("@whiskeysockets/baileys");

const sessionDir = path.join(__dirname, "session");

router.get('/', async (req, res) => {
    const id = giftedId();
    let num = req.query.number;
    let responseSent = false;
    let sessionCleanedUp = false;

    async function cleanUpSession() {
        if (!sessionCleanedUp) {
            try {
                await removeFile(path.join(sessionDir, id));
            } catch (cleanupError) {
                console.error("Cleanup error:", cleanupError);
            }
            sessionCleanedUp = true;
        }
    }

    async function GIFTED_PAIR_CODE() {
        const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));
        console.log('WA version:', version);
        const { state, saveCreds } = await useMultiFileAuthState(path.join(sessionDir, id));
        try {
            let Gifted = giftedConnect({
                version,
                auth: state,
                printQRInTerminal: false,
                logger: pino({ level: "silent" }),
                browser: Browsers.ubuntu("Chrome"),
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000
            });

            num = num.replace(/[^0-9]/g, '');
            console.log('Requesting pair code for number:', num);

            Gifted.ev.on('creds.update', saveCreds);

            // Request pair code immediately (correct approach for @whiskeysockets/baileys)
            if (!Gifted.authState.creds.registered) {
                try {
                    const code = await Gifted.requestPairingCode(num);
                    console.log('Pair code generated:', code);
                    if (!responseSent && !res.headersSent) {
                        res.json({ code: code });
                        responseSent = true;
                    }
                } catch (pairErr) {
                    console.error("Pair code error:", pairErr);
                    if (!responseSent && !res.headersSent) {
                        res.status(500).json({ code: "Service is Currently Unavailable" });
                        responseSent = true;
                    }
                    await cleanUpSession();
                    return;
                }
            }

            Gifted.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect } = s;

                if (connection === "open") {
                    console.log('Connection opened, reading session...');
                    await delay(3000);

                    let sessionData = null;
                    let attempts = 0;
                    const maxAttempts = 10;

                    while (attempts < maxAttempts && !sessionData) {
                        try {
                            const credsPath = path.join(sessionDir, id, "creds.json");
                            if (fs.existsSync(credsPath)) {
                                const data = fs.readFileSync(credsPath);
                                if (data && data.length > 100) {
                                    sessionData = data;
                                    break;
                                }
                            }
                            await delay(2000);
                            attempts++;
                        } catch (readError) {
                            console.error("Read error:", readError);
                            await delay(2000);
                            attempts++;
                        }
                    }

                    if (!sessionData) {
                        console.error('Session data not found after', maxAttempts, 'attempts');
                        await cleanUpSession();
                        return;
                    }

                    try {
                        let compressedData = zlib.gzipSync(sessionData);
                        let b64data = compressedData.toString('base64');

                        let sessionSent = false;
                        let sendAttempts = 0;
                        const maxSendAttempts = 5;

                        while (sendAttempts < maxSendAttempts && !sessionSent) {
                            try {
                                await sendButtons(Gifted, Gifted.user.id, {
                                    title: '',
                                    image: { url: 'https://i.imgur.com/YOUR_IMAGE_ID.jpg' },
                                    text: 'PRINCE-MDX!' + b64data,
                                    footer: `> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴍᴀʀᴋ ꜱᴜᴍᴏ ʙᴏᴛ*`,
                                    buttons: [
                                        {
                                            name: 'cta_copy',
                                            buttonParamsJson: JSON.stringify({
                                                display_text: 'Copy Session',
                                                copy_code: 'PRINCE-MDX!' + b64data
                                            })
                                        },
                                        {
                                            name: 'cta_url',
                                            buttonParamsJson: JSON.stringify({
                                                display_text: 'Join Group',
                                                url: 'https://chat.whatsapp.com/HAbxMgKY0ATCRYYQpFUri2',
                                                merchant_url: 'https://chat.whatsapp.com/HAbxMgKY0ATCRYYQpFUri2'
                                            })
                                        }
                                    ]
                                });
                                sessionSent = true;
                                console.log('Session sent successfully');
                            } catch (sendError) {
                                console.error("Send error:", sendError);
                                sendAttempts++;
                                if (sendAttempts < maxSendAttempts) await delay(3000);
                            }
                        }

                        await delay(3000);
                        await Gifted.ws.close();
                    } catch (sessionError) {
                        console.error("Session processing error:", sessionError);
                    } finally {
                        await cleanUpSession();
                    }

                } else if (connection === "close") {
                    console.log("Connection closed:", lastDisconnect?.error?.message);
                }
            });

        } catch (err) {
            console.error("Main error:", err);
            if (!responseSent && !res.headersSent) {
                res.status(500).json({ code: "Service is Currently Unavailable" });
                responseSent = true;
            }
            await cleanUpSession();
        }
    }

    try {
        await GIFTED_PAIR_CODE();
    } catch (finalError) {
        console.error("Final error:", finalError);
        await cleanUpSession();
        if (!responseSent && !res.headersSent) {
            res.status(500).json({ code: "Service Error" });
        }
    }
});

module.exports = router;
