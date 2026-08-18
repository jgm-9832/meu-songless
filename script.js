const btnPlay = document.getElementById('play-btn');
const tempoDisplay = document.getElementById('tempo-display');
const msgArea = document.getElementById('status-msg');
const btnSkip = document.getElementById('enviar-btn');
const inputChute = document.getElementById('chute');
const listaPesquisa = document.getElementById('lista-pesquisa');
const streakDisplay = document.getElementById('streak-display');
const btnNextRound = document.getElementById('next-round-btn'); 
const vibePlayPauseBtn = document.getElementById('vibe-play-pause-btn');
const spotifyLinkBtn = document.getElementById('spotify-link-btn');

const CLIENT_ID = 035ea29d325b48a1af909c612380e63f'; // <-- COLOQUE SEU ID NOVO AQUI
const REDIRECT_URI = 'https://jgm-9832.github.io/meu-songless/'; 

// --- AUTENTICAÇÃO COM O SPOTIFY ---
function gerarStringAleatoria(tamanho) {
    const caracteres = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const valores = crypto.getRandomValues(new Uint8Array(tamanho));
    return valores.reduce((acc, x) => acc + caracteres[x % caracteres.length], "");
}

async function gerarDesafio(codigoVerificador) {
    const dados = new TextEncoder().encode(codigoVerificador);
    const hash = await window.crypto.subtle.digest('SHA-256', dados);
    return btoa(String.fromCharCode.apply(null, [...new Uint8Array(hash)]))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

async function fazerLoginSpotify() {
    const verificador = gerarStringAleatoria(64);
    window.localStorage.setItem('codigo_verificador', verificador);
    const desafio = await gerarDesafio(verificador);

    const parametros = new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        scope: 'user-library-read streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state',
        code_challenge_method: 'S256',
        code_challenge: desafio
    });

    window.location.href = `https://accounts.spotify.com/authorize?${parametros.toString()}`;
}

async function trocarCodigoPorToken() {
    const urlParams = new URLSearchParams(window.location.search);
    const codigo = urlParams.get('code');

    if (codigo) {
        const verificador = window.localStorage.getItem('codigo_verificador');
        
        const resposta = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: CLIENT_ID,
                grant_type: 'authorization_code',
                code: codigo,
                redirect_uri: REDIRECT_URI,
                code_verifier: verificador
            })
        });

        const dados = await resposta.json();
        
        if (dados.access_token) {
            const tempoExpiracao = Date.now() + (dados.expires_in * 1000);
            window.localStorage.setItem('spotify_token', dados.access_token);
            window.localStorage.setItem('spotify_token_exp', tempoExpiracao);
            window.history.replaceState({}, document.title, window.location.pathname);
            return dados.access_token;
        }
    }
    return null;
}

// --- VARIÁVEIS DO JOGO ---
let tokenDeAcesso = null;
let playlistReal = []; 
let musicaAtual = null; 
let deviceId = null; 
let tempos = [1, 2, 4, 7, 11, 16]; 
let tentativaAtual = 0; 
let tocando = false; 
let cronometro; 
let streakCount = 0; 

// --- INICIALIZAÇÃO INTELIGENTE (PC e Celular) ---
async function iniciarJogo() {
    const tokenSalvo = window.localStorage.getItem('spotify_token');
    const tokenExp = window.localStorage.getItem('spotify_token_exp');

    if (tokenSalvo && tokenExp && Date.now() < parseInt(tokenExp)) {
        tokenDeAcesso = tokenSalvo;
    } else {
        tokenDeAcesso = await trocarCodigoPorToken();
    }

    if (!tokenDeAcesso) {
        msgArea.innerHTML = `<button onclick="fazerLoginSpotify()" style="background-color: #1DB954; color: #121212; border: none; padding: 10px 20px; border-radius: 20px; font-weight: bold; cursor: pointer;">🟢 Conectar com o Spotify</button>`;
    } else {
        msgArea.innerText = "✅ Autenticado! Verificando dispositivo...";
        
        // Verifica se o usuário está no celular
        const ehCelular = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

        if (ehCelular) {
            msgArea.innerText = "Procurando seu App do Spotify...";
            buscarDispositivosAtivos();
        } else {
            const script = document.createElement("script");
            script.src = "https://sdk.scdn.co/spotify-player.js";
            document.body.appendChild(script);

            window.onSpotifyWebPlaybackSDKReady = () => {
                const playerSp = new Spotify.Player({ name: 'Songless Premium', getOAuthToken: cb => { cb(tokenDeAcesso); }, volume: 1.0 });
                playerSp.addListener('ready', ({ device_id }) => { 
                    deviceId = device_id; 
                    carregarMusicas(); 
                });
                playerSp.connect();
            };
        }
    }
}

// --- FUNÇÃO NOVA: BUSCAR O APP NO CELULAR ---
async function buscarDispositivosAtivos() {
    try {
        const resposta = await fetch('https://api.spotify.com/v1/me/player/devices', {
            headers: { 'Authorization': 'Bearer ' + tokenDeAcesso }
        });
        const dados = await resposta.json();
        
        if (dados.devices && dados.devices.length > 0) {
            deviceId = dados.devices[0].id;
            carregarMusicas();
        } else {
            msgArea.innerHTML = `⚠️ Abra o app do Spotify, dê play e pause numa música, e depois <button onclick="buscarDispositivosAtivos()" style="background-color: #1DB954; color: #121212; border: none; padding: 5px 10px; border-radius: 10px; cursor: pointer;">Clique Aqui</button>`;
        }
    } catch (e) {
        msgArea.innerText = "Erro ao buscar dispositivos.";
    }
}

// BLOQUEADOR DE SPOILER (MediaSession API)
if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: 'Songless', artist: 'Adivinhe a música', album: 'Modo Jogo', artwork: [] });
    navigator.mediaSession.setActionHandler('play', null);
    navigator.mediaSession.setActionHandler('pause', null);
}

// --- CARREGAMENTO DE MÚSICAS (À PROVA DE ERRO 429) ---
async function carregarMusicas() {
    const cacheKey = 'playlist_songless';
    const cacheTimeKey = 'playlist_time_songless';
    const sessentaMinutos = 60 * 60 * 1000; 
    const cacheSalvo = localStorage.getItem(cacheKey);
    const tempoCache = localStorage.getItem(cacheTimeKey);

    if (cacheSalvo && tempoCache && (Date.now() - tempoCache < sessentaMinutos)) {
        playlistReal = JSON.parse(cacheSalvo);
        sortearMusica();
        msgArea.innerText = "🔥 Playlist carregada (cache)!";
        return;
    }

    try {
        msgArea.innerText = "Baixando músicas (isso pode levar um tempinho)...";
        let url = 'https://api.spotify.com/v1/me/tracks?limit=50';
        let musicasBrutas = [];
        let paginas = 0;

        while (url && paginas < 40) {
            const resposta = await fetch(url, { headers: { 'Authorization': 'Bearer ' + tokenDeAcesso }});
            
            if (resposta.status === 429) {
                console.log("Limite do Spotify atingido! Salvando as músicas que já pegamos...");
                break; 
            }
            
            const dados = await resposta.json();
            musicasBrutas = musicasBrutas.concat(dados.items.map(i => i.track).filter(t => t !== null));
            url = dados.next;
            paginas++;
            
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        let mapa = new Map();
        musicasBrutas.forEach(m => mapa.set(m.id, m));
        playlistReal = Array.from(mapa.values());

        if (playlistReal.length > 0) {
            localStorage.setItem(cacheKey, JSON.stringify(playlistReal));
            localStorage.setItem(cacheTimeKey, Date.now());
            sortearMusica();
            msgArea.innerText = `🔥 Pronto! ${playlistReal.length} músicas carregadas!`;
        } else {
            msgArea.innerText = "Spotify bloqueado. Tente daqui a pouco.";
        }

    } catch (e) { 
        msgArea.innerText = "Erro ao carregar músicas."; 
        console.error(e);
    }
}

function sortearMusica() { musicaAtual = playlistReal[Math.floor(Math.random() * playlistReal.length)]; }

// --- CONTROLES DO JOGO ---
iniciarJogo();

vibePlayPauseBtn.addEventListener('click', async () => {
    if (tocando) { await pausarMusica(); tocando = false; vibePlayPauseBtn.innerText = "▶️ Tocar"; } 
    else { try { await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, { method: 'PUT', headers: { 'Authorization': 'Bearer ' + tokenDeAcesso }}); tocando = true; vibePlayPauseBtn.innerText = "⏸️ Pausar"; } catch(e) {} }
});

async function pausarMusica() { try { await fetch(`https://api.spotify.com/v1/me/player/pause?device_id=${deviceId}`, { method: 'PUT', headers: { 'Authorization': 'Bearer ' + tokenDeAcesso }}); } catch(e) {} }

function mostrarCapaDaMusica(acertou) {
    document.getElementById('album-cover').src = musicaAtual.album.images[0]?.url || "";
    document.getElementById('musica-revelada').innerText = `${musicaAtual.name} - ${musicaAtual.artists[0].name}`;
    document.getElementById('musica-revelada').style.color = acertou ? "#1DB954" : "red";
    spotifyLinkBtn.href = musicaAtual.external_urls.spotify;
    document.querySelector('.player-area').style.display = 'none';
    document.querySelector('.search-area').style.display = 'none';
    document.getElementById('album-cover-area').style.display = 'block';
}

btnNextRound.addEventListener('click', async () => {
    if (tocando) await pausarMusica();
    sortearMusica();
    tentativaAtual = 0; tocando = false;
    document.getElementById('album-cover-area').style.display = 'none';
    document.querySelector('.player-area').style.display = 'flex';
    document.querySelector('.search-area').style.display = 'flex';
    tempoDisplay.innerText = tempos[0] + "s";
});

btnPlay.addEventListener('click', async () => {
    if (!deviceId || tocando) return;
    tocando = true;
    try {
        await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
            method: 'PUT',
            headers: { 'Authorization': 'Bearer ' + tokenDeAcesso, 'Content-Type': 'application/json' },
            body: JSON.stringify({ uris: [musicaAtual.uri], position_ms: 0 })
        });
        cronometro = setTimeout(async () => { await pausarMusica(); tocando = false; }, (tempos[tentativaAtual] * 1000) + 450);
    } catch(e) { tocando = false; }
});

inputChute.addEventListener('input', () => {
    let filtradas = playlistReal.filter(m => m.name.toLowerCase().includes(inputChute.value.toLowerCase()));
    listaPesquisa.innerHTML = '';
    filtradas.slice(0, 5).forEach(m => {
        let li = document.createElement('li');
        li.innerText = m.name;
        li.onclick = async () => {
            if(m.id === musicaAtual.id) {
                clearTimeout(cronometro);
                msgArea.innerText = "🎉 ACERTOU!";
                streakCount++;
                streakDisplay.innerText = `🔥 Sequência: ${streakCount}`;
                mostrarCapaDaMusica(true);
                if (typeof confetti === "function") confetti({ particleCount: 150 });
            } else {
                tentativaAtual++;
                msgArea.innerText = "Errado!";
            }
            listaPesquisa.style.display = 'none';
        };
        listaPesquisa.appendChild(li);
    });
    listaPesquisa.style.display = filtradas.length > 0 ? 'block' : 'none';
});
