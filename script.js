const supabaseUrl = 'https://wghquruwkuilptpgpzpg.supabase.co';
const supabaseKey = 'sb_publishable_PiwI5fZNTUy24dJcDgea5w_2Y2NIYDK';
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

let currentUser = "";
let currentRoomId = null;
let mySymbol = ""; 
let gameTimer = null;
let timeLeft = 30;
let currentGameType = "";

const screens = {
    login: document.getElementById('login-screen'),
    main: document.getElementById('main-screen'),
    game: document.getElementById('game-screen')
};

// --- ورود به برنامه ---
document.getElementById('enter-btn').addEventListener('click', () => {
    const nameInput = document.getElementById('username').value.trim();
    if (nameInput) {
        currentUser = nameInput;
        document.getElementById('user-display').innerText = `کاربر: ${currentUser}`;
        switchScreen('main');
        listenToAllRooms();
    }
});

function switchScreen(screenName) {
    Object.keys(screens).forEach(key => screens[key].style.display = 'none');
    screens[screenName].style.display = 'flex';
}

// --- مدیریت اتاق‌ها در Supabase ---
async function createRoom(gameType) {
    currentGameType = gameType;
    const boardSize = (gameType === 'tic-tac-toe-3') ? 9 : 49;
    let initialBoard = Array(boardSize).fill("");
    
    if (gameType === 'minesweeper') {
        initialBoard = generateMines(49, 15);
    }

    const { data, error } = await _supabase
        .from('rooms')
        .insert([{
            creator: currentUser,
            type: gameType,
            status: 'waiting',
            board: initialBoard,
            turn: 'X',
            scores: { X: 0, O: 0 }
        }])
        .select();

    if (error) return;
    
    currentRoomId = data[0].id;
    mySymbol = 'X';
    
    sendToTelegram(currentUser, gameType);
    document.getElementById('game-selection-modal').style.display = 'none';
    switchScreen('game');
    initGameBoard(gameType);
    subscribeToRoom(currentRoomId);
}

function generateMines(size, count) {
    let board = Array(size).fill("safe");
    let minesPlaced = 0;
    while (minesPlaced < count) {
        let idx = Math.floor(Math.random() * size);
        if (board[idx] !== "mine") {
            board[idx] = "mine";
            minesPlaced++;
        }
    }
    return board;
}

// --- ارسال به تلگرام از طریق Google Script ---
function sendToTelegram(user, game) {
    const scriptUrl = "https://script.google.com/macros/s/AKfycbwcXTA2S7hRT3xnC7GPNXV6hg2uMgzyPcS7OElMYGZAwwCzVBiX2niPEduQYpnhKEbZ/exec";
    fetch(scriptUrl, {
        method: 'POST',
        mode: 'no-cors',
        body: JSON.stringify({ user, game, action: 'new_room' })
    });
}

// --- ساخت بورد بازی ---
function initGameBoard(type) {
    const container = document.getElementById('game-board-container');
    container.innerHTML = "";
    const size = (type === 'tic-tac-toe-3') ? 3 : 7;
    const gridClass = (type === 'tic-tac-toe-3') ? 'grid-3x3' : 'grid-7x7';
    
    const boardDiv = document.createElement('div');
    boardDiv.className = gridClass;
    
    for (let i = 0; i < size * size; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.index = i;
        cell.addEventListener('click', () => handleMove(i));
        boardDiv.appendChild(cell);
    }
    container.appendChild(boardDiv);
    startTimer();
}

async function handleMove(index) {
    const { data: room } = await _supabase.from('rooms').select('*').eq('id', currentRoomId).single();
    
    if (room.status !== 'playing' || room.turn !== mySymbol || room.board[index] === "X" || room.board[index] === "O") return;

    let newBoard = [...room.board];
    let nextTurn = room.turn === 'X' ? 'O' : 'X';

    if (currentGameType === 'minesweeper') {
        if (newBoard[index] === "mine") {
            newBoard[index] = "found_mine_" + mySymbol;
        } else {
            newBoard[index] = "revealed_" + mySymbol;
        }
    } else {
        newBoard[index] = mySymbol;
    }

    await _supabase.from('rooms').update({ board: newBoard, turn: nextTurn }).eq('id', currentRoomId);
    checkWinnerLogic(newBoard, room.type);
}

// --- مدیریت زمان ---
function startTimer() {
    clearInterval(gameTimer);
    timeLeft = 30;
    document.getElementById('game-timer').innerText = timeLeft;
    gameTimer = setInterval(async () => {
        timeLeft--;
        document.getElementById('game-timer').innerText = timeLeft;
        if (timeLeft <= 0) {
            clearInterval(gameTimer);
            endGame("زمان تمام شد! حریف برنده شد.");
        }
    }, 1000);
}

// --- Realtime Subscriptions ---
function listenToAllRooms() {
    _supabase.channel('public:rooms')
    .on('postgres_changes', { event: '*', table: 'rooms' }, payload => {
        renderRoomsList();
    }).subscribe();
}

function subscribeToRoom(id) {
    _supabase.channel(`room:${id}`)
    .on('postgres_changes', { event: 'UPDATE', table: 'rooms', filter: `id=eq.${id}` }, payload => {
        const room = payload.new;
        updateUI(room);
    }).subscribe();
}

function updateUI(room) {
    const cells = document.querySelectorAll('.cell');
    room.board.forEach((val, i) => {
        if (val === "X" || val === "O") {
            cells[i].innerText = val;
            cells[i].className = `cell ${val.toLowerCase()}`;
        }
    });
    document.getElementById('turn-indicator').innerText = room.turn === mySymbol ? "نوبت شماست" : "نوبت حریف";
    startTimer();
}

function endGame(msg) {
    clearInterval(gameTimer);
    document.getElementById('result-message').innerText = msg;
    document.getElementById('result-overlay').style.display = 'flex';
}

// --- Event Listeners ---
document.getElementById('create-room-btn').onclick = () => document.getElementById('game-selection-modal').style.display = 'flex';
document.querySelector('.btn-close-modal').onclick = () => document.getElementById('game-selection-modal').style.display = 'none';
document.querySelectorAll('.game-opt').forEach(btn => {
    btn.onclick = () => createRoom(btn.dataset.type);
});
document.getElementById('exit-room-btn').onclick = () => location.reload();
document.getElementById('close-room-btn').onclick = () => location.reload();
