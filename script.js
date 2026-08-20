// ==========================================
// 0. LIMPEZA DE CACHE
// ==========================================
if (!localStorage.getItem('cache_limpo_v4')) {
    localStorage.clear();
    localStorage.setItem('cache_limpo_v4', 'true');
}

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

// COLOQUE SEU CLIENT ID AQUI!
const CLIENT_ID = '035ea29d325b48a1af909c612380e63f'; 
const REDIRECT_URI = 'https://jgm-9832.github.io/meu-songless/'; 

// ==========================================
// 1. LOGIN
// ==========================================
function gerarStringAleatoria(tamanho) {
    const caracteres = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const valores = crypto.getRandomValues(new Uint8Array(tamanho));
    return valores.reduce((acc, x) => acc + caracteres[x % caracteres.length], "");
}

async function gerarDesafio(codigoVerificador) {
    const dados = new TextEncoder().encode(codigoVerificador);
    const hash = await window.crypto.subtle.digest('SHA-256', dados);
    return btoa(String.fromCharCode.apply(null, [...new Uint8Array(hash)])).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
                client_id: CLIENT_ID, grant_type: 'authorization_code', code: codigo, redirect_uri: REDIRECT_URI, code_verifier: verificador
            })
        });

        const dados = await resposta.json();
        
        if (dados.access_token) {
            window.localStorage.setItem('spotify_token', dados.access_token);
            window.localStorage.setItem('spotify_token_exp', Date.now() + (dados.expires_in * 1000));
            window.history.replaceState({}, document.title, window.location.pathname);
            return dados.access_token;
        }
    }
    return null;
}

// ==========================================
// 2. INICIALIZAÇÃO (SEM MOTOR INVISÍVEL)
// ==========================================
let tokenDeAcesso = null;
let playlistReal = []; 
let musicaAtual = null; 
let deviceId = null; 

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
        msgArea.innerText = "✅ Autenticado! Procurando o seu app do Spotify...";
        buscarDispositivosAtivos();
    }
}

// O Jogo agora procura o App que tá aberto no seu PC/Celular
async function buscarDispositivosAtivos() {
    try {
        const resposta = await fetch('https://api.spotify.com/v1/me/player/devices', {
            headers: { 'Authorization': 'Bearer ' + tokenDeAcesso }
        });
        const dados = await resposta.json();
        
        if (dados.devices && dados.devices.length > 0) {
            // Pega o dispositivo que estiver ativo, senão pega o primeiro da lista
            let disp = dados.devices.find(d => d.is_active) || dados.devices[0];
            deviceId = disp.id;
            console.log("Conectado ao dispositivo:", disp.name);
            carregarMusicas();
        } else {
            msgArea.innerHTML = `⚠️ Abra o app do Spotify, dê play e pause numa música, e <button onclick="buscarDispositivosAtivos()" style="background-color: #1DB954; color: #121212; border: none; padding: 5px 10px; border-radius: 10px; cursor: pointer;">Clique Aqui</button>`;
        }
    } catch (e) {
        msgArea.innerText = "Erro ao buscar dispositivos.";
    }
}

// ==========================================
// 3. CARREGAR MÚSICAS de 50 em 50
// ==========================================
async function carregarMusicas() {
    // Tenta carregar do Cache primeiro
    const cacheKey = 'playlist_songless';
    const cacheSalvo = localStorage.getItem(cacheKey);
    if (cacheSalvo) {
        playlistReal = JSON.parse(cacheSalvo);
        sortearMusica();
        msgArea.innerText = `🔥 ${playlistReal.length} músicas carregadas do cache!`;
        return;
    }

    try {
        // Começamos na primeira página
        let url = 'https://api.spotify.com/v1/me/tracks?limit=50';
        let musicasBrutas = [];
        let paginas = 0;
        let maximoDePaginas = 40; // 20 páginas x 50 músicas = 1000 músicas máximo

        msgArea.innerText = "Baixando sua biblioteca completa...";

        while (url && paginas < maximoDePaginas) {
            const resposta = await fetch(url, { headers: { 'Authorization': 'Bearer ' + tokenDeAcesso }});
            
            // Se o Spotify der "calma aí" (429), paramos e usamos o que já temos
            if (resposta.status === 429) {
                console.log("Limite atingido, parando a busca...");
                break; 
            }
            
            const dados = await resposta.json();
            
            // Adiciona as músicas do pacote atual
            const novasMusicas = dados.items.map(item => item.track).filter(t => t !== null);
            musicasBrutas = musicasBrutas.concat(novasMusicas);
            
            // A mágica: pegamos o link da próxima página
            url = dados.next; 
            paginas++;
            
            // Mostra o progresso
            msgArea.innerText = `Baixando... (${musicasBrutas.length} músicas encontradas)`;
            
            // Pequena pausa de 200ms para não levar bloqueio
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        // Remove duplicadas, se houver
        let mapaDeMusicas = new Map();
        musicasBrutas.forEach(m => mapaDeMusicas.set(m.id, m));
        playlistReal = Array.from(mapaDeMusicas.values());

        if (playlistReal.length > 0) {
            localStorage.setItem(cacheKey, JSON.stringify(playlistReal));
            sortearMusica();
            msgArea.innerText = `🔥 Pronto! ${playlistReal.length} músicas na sua biblioteca!`;
        }
    } catch (erro) {
        console.error(erro);
        msgArea.innerText = "Erro ao buscar biblioteca.";
        // ==========================================
// FUNÇÃO DE SORTEIO (Que tinha sumido!)
// ==========================================
function sortearMusica() {
    if (playlistReal.length > 0) {
        let indiceSorteado = Math.floor(Math.random() * playlistReal.length);
        musicaAtual = playlistReal[indiceSorteado];
        console.log("🤫 A resposta correta é: ", musicaAtual.name); 
    }
}

// Inicia o jogo depois que tudo está configurado
iniciarJogo();
    }
}
iniciarJogo();

// ==========================================
// 4. LÓGICA DO JOGO
// ==========================================
let tempos = [1, 2, 4, 7, 11, 16]; 
let tentativaAtual = 0; 
let tocando = false; 
let jogoFinalizado = false; 
let cronometro; 
let streakCount = 0; 

vibePlayPauseBtn.addEventListener('click', async () => {
    if (tocando) {
        await pausarMusica();
        tocando = false;
        vibePlayPauseBtn.innerText = "▶️ Tocar";
    } else {
        try {
            await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
                method: 'PUT',
                headers: { 'Authorization': 'Bearer ' + tokenDeAcesso }
            });
            tocando = true;
            vibePlayPauseBtn.innerText = "⏸️ Pausar";
        } catch(e) {}
    }
});

function atualizarStreak(ganhou) {
    if (ganhou) {
        streakCount++;
        streakDisplay.style.color = '#1DB954'; 
    } else {
        streakCount = 0;
        streakDisplay.style.color = 'red'; 
    }
    streakDisplay.innerText = `🔥 Sequência: ${streakCount}`;
    setTimeout(() => { streakDisplay.style.color = '#ff9800'; }, 1500);
}

function travarBotaoPlay(travar) {
    if (travar) {
        btnPlay.disabled = true;
        btnPlay.style.opacity = '0.5';
        btnPlay.style.cursor = 'not-allowed';
    } else {
        btnPlay.disabled = false;
        btnPlay.style.opacity = '1';
        btnPlay.style.cursor = 'pointer';
    }
}

async function pausarMusica() {
    try {
        await fetch(`https://api.spotify.com/v1/me/player/pause?device_id=${deviceId}`, {
            method: 'PUT', headers: { 'Authorization': 'Bearer ' + tokenDeAcesso }
        });
    } catch(e) {}
}

function mostrarCapaDaMusica(acertou) {
    const albumArea = document.getElementById('album-cover-area');
    const albumImg = document.getElementById('album-cover');
    const tituloRevealed = document.getElementById('musica-revelada');

    if (musicaAtual.album.images && musicaAtual.album.images.length > 0) {
        albumImg.src = musicaAtual.album.images[0].url; 
    } else {
        albumImg.src = "https://developer.spotify.com/images/guidelines/design/icon3@2x.png";
    }

    tituloRevealed.innerText = `${musicaAtual.name} - ${musicaAtual.artists[0].name}`;
    tituloRevealed.style.color = acertou ? "#1DB954" : "red";

    if (musicaAtual.external_urls && musicaAtual.external_urls.spotify) {
        spotifyLinkBtn.href = musicaAtual.external_urls.spotify;
        spotifyLinkBtn.style.display = 'inline-flex';
    } else {
        spotifyLinkBtn.style.display = 'none';
    }
    
    vibePlayPauseBtn.innerText = "⏸️ Pausar";
    document.querySelector('.player-area').style.display = 'none';
    document.querySelector('.search-area').style.display = 'none';
    albumArea.style.display = 'block';
}

async function proximaRodada() {
    clearTimeout(cronometro);
    if (tocando) await pausarMusica();
    
    sortearMusica();
    tentativaAtual = 0;
    jogoFinalizado = false;
    tocando = false;
    travarBotaoPlay(false);
    
    document.getElementById('album-cover-area').style.display = 'none';
    document.querySelector('.player-area').style.display = 'flex';
    document.querySelector('.search-area').style.display = 'flex';
    
    tempoDisplay.innerText = tempos[0] + "s";
    inputChute.value = "";
    
    for(let i = 0; i <= 5; i++) {
        let box = document.getElementById('box-' + i);
        if (box) box.style.backgroundColor = '#535353';
    }
    
    msgArea.innerText = "Nova rodada! Aperte Play.";
    msgArea.style.color = "#b3b3b3";
}

if(btnNextRound) btnNextRound.addEventListener('click', proximaRodada);

async function avancaTentativa(motivo) {
    if (jogoFinalizado) return;

    if (tocando) {
        clearTimeout(cronometro);
        await pausarMusica();
        tocando = false;
        travarBotaoPlay(false);
    }

    if (tentativaAtual < 5) {
        tentativaAtual++;
        tempoDisplay.innerText = tempos[tentativaAtual] + "s";
        msgArea.innerText = `${motivo} Tempo aumentado para ${tempos[tentativaAtual]}s!`;
        msgArea.style.color = "#b3b3b3";
    } else {
        msgArea.innerText = `❌ Fim de jogo!`;
        jogoFinalizado = true;
        
        atualizarStreak(false); 
        mostrarCapaDaMusica(false); 

        try {
            await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
                method: 'PUT',
                headers: { 'Authorization': 'Bearer ' + tokenDeAcesso, 'Content-Type': 'application/json' },
                body: JSON.stringify({ uris: [musicaAtual.uri], position_ms: 0 })
            });
            tocando = true;
        } catch(e) {}
    }
}

if(btnPlay) {
    btnPlay.addEventListener('click', async () => {
        if (!tokenDeAcesso || !deviceId) {
            alert("Não achamos seu App do Spotify. Abra ele e tente de novo!");
            return;
        }
        if (playlistReal.length === 0 || jogoFinalizado) return;
        if (btnPlay.disabled || tocando) return; 

        let tempoLimite = tempos[tentativaAtual];
        let tentativaAoDarPlay = tentativaAtual;
        
        tocando = true;
        travarBotaoPlay(true); 
        
        let box = document.getElementById('box-' + tentativaAtual);
        if(box) box.style.backgroundColor = '#1DB954';
        
        tempoDisplay.innerText = tempoLimite + "s";
        msgArea.innerText = "Tocando..."; 
        msgArea.style.color = "#b3b3b3"; 

        try {
            await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
                method: 'PUT',
                headers: { 'Authorization': 'Bearer ' + tokenDeAcesso, 'Content-Type': 'application/json' },
                body: JSON.stringify({ uris: [musicaAtual.uri], position_ms: 0 })
            });
            
            if (!tocando || tentativaAtual !== tentativaAoDarPlay) {
                await pausarMusica();
                travarBotaoPlay(false);
                return;
            }
            
            cronometro = setTimeout(async () => {
                await pausarMusica();
                setTimeout(pausarMusica, 250); 
                if (!jogoFinalizado) {
                    msgArea.innerText = "Tempo esgotado! Tente adivinhar ou pule.";
                }
                tocando = false; 
                travarBotaoPlay(false); 
            }, (tempoLimite * 1000) + 450);

        } catch(erro) { 
            console.error("Erro no play:", erro); 
            tocando = false;
            travarBotaoPlay(false); 
        }
    });
}

if(btnSkip) {
    btnSkip.addEventListener('click', () => {
        if (jogoFinalizado) return;
        avancaTentativa("Você pulou.");
    });
}

// ==========================================
// 5. CAIXA DE PESQUISA
// ==========================================
if(inputChute) {
    inputChute.addEventListener('input', () => {
        let digitado = inputChute.value.toLowerCase(); 
        listaPesquisa.innerHTML = ''; 
        
        if (digitado.length === 0 || jogoFinalizado) {
            listaPesquisa.style.display = 'none';
            return;
        }

        let filtradas = playlistReal.filter(musica => 
            musica.name.toLowerCase().includes(digitado) || 
            musica.artists[0].name.toLowerCase().includes(digitado)
        );

        let musicasUnicas = [];
        let idsVistos = new Set();
        for (let m of filtradas) {
            if (!idsVistos.has(m.id)) {
                idsVistos.add(m.id);
                musicasUnicas.push(m);
            }
        }

        if (musicasUnicas.length > 0) {
            listaPesquisa.style.display = 'block';
            
            musicasUnicas.slice(0, 15).forEach(musica => { 
                let item = document.createElement('li');
                item.innerHTML = `${musica.name} <span>${musica.artists[0].name}</span>`;
                
                item.addEventListener('click', async () => {
                    inputChute.value = musica.name; 
                    listaPesquisa.style.display = 'none'; 
                    
                    if(musica.id === musicaAtual.id) {
                        if (tocando) {
                            clearTimeout(cronometro);
                            travarBotaoPlay(false);
                        } else {
                            try {
                                await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
                                    method: 'PUT',
                                    headers: { 'Authorization': 'Bearer ' + tokenDeAcesso, 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ uris: [musicaAtual.uri], position_ms: 0 })
                                });
                                tocando = true;
                            } catch(e) {}
                        }
                        
                        msgArea.innerText = "🎉 VOCÊ ACERTOU!!!";
                        jogoFinalizado = true;
                        
                        atualizarStreak(true); 
                        mostrarCapaDaMusica(true); 

                        if (typeof confetti === "function") {
                            confetti({ particleCount: 150, spread: 80, origin: { y: 0.6 }, zIndex: 9999 });
                        }

                    } else {
                        avancaTentativa("Música errada!");
                    }
                });
                
                listaPesquisa.appendChild(item); 
            });
        } else {
            listaPesquisa.style.display = 'none';
        }
    });
}

// ==========================================
// 6. FILTROS E DIFICULDADES
// ==========================================
const botoesCategoria = document.querySelectorAll('.cat-btn');
const botoesDificuldade = document.querySelectorAll('.diff-btn');

botoesCategoria.forEach(botao => {
    botao.addEventListener('click', () => {
        botoesCategoria.forEach(b => b.classList.remove('active'));
        botao.classList.add('active');
        msgArea.innerText = `Filtro alterado para: ${botao.innerText}`;
    });
});

const temposPorDificuldade = {
    'Easy': [2, 4, 7, 11, 16, 25],
    'Medium': [1, 2, 4, 7, 11, 16],
    'Hard': [0.5, 1, 2, 4, 7, 10],
    'Expert': [0.2, 0.5, 1, 2, 4, 6],
    'Impossible': [0.1, 0.3, 0.5, 1, 2, 3]
};

botoesDificuldade.forEach(botao => {
    botao.addEventListener('click', async () => {
        botoesDificuldade.forEach(b => {
            b.style.backgroundColor = '#282828';
            b.style.color = '#b3b3b3';
            if(b.classList.contains('impossible')) {
                b.style.backgroundColor = 'transparent';
                b.style.color = '#9c27b0';
            }
        });

        if(botao.classList.contains('impossible')) {
            botao.style.backgroundColor = '#9c27b0';
            botao.style.color = 'white';
        } else {
            botao.style.backgroundColor = '#1DB954';
            botao.style.color = '#121212';
        }

        let nomeDificuldade = botao.innerText;
        tempos = temposPorDificuldade[nomeDificuldade]; 

        tentativaAtual = 0;
        jogoFinalizado = false;
        inputChute.value = "";
        
        document.getElementById('album-cover-area').style.display = 'none';
        document.querySelector('.player-area').style.display = 'flex';
        document.querySelector('.search-area').style.display = 'flex';

        tempoDisplay.innerText = tempos[0] + "s";
        
        if (tocando) {
            clearTimeout(cronometro);
            await pausarMusica();
            tocando = false;
            travarBotaoPlay(false);
        }
        
        for(let i = 0; i <= 5; i++) {
            let box = document.getElementById('box-' + i);
            if (box) box.style.backgroundColor = '#535353';
        }

        msgArea.innerText = `Dificuldade alterada para ${nomeDificuldade}! Aperte Play.`;
        msgArea.style.color = "#b3b3b3";
    });
});
