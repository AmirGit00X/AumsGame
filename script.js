const supabaseUrl = 'https://wghquruwkuilptpgpzpg.supabase.co';
const supabaseKey = 'sb_publishable_PiwI5fZNTUy24dJcDgea5w_2Y2NIYDK';
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

let currentUser = "";
let currentRoomId = null;
let mySymbol = ""; 
let gameTimer = null;
let timeLeft = 30;

// --- مدیریت حافظه ۲۴ ساعته نام کاربری ---
window.onload = () => {
    const savedName = localStorage.getItem('aums_user');
    const savedTime = localStorage.getItem('aums_time');
    const now = new Date().getTime();

    if (savedName && savedTime && (now - savedTime < 24 * 60 * 60 * 1000)) {
        currentUser = savedName;
        initApp();
    } else {
        document.getElementById('loading-screen').style.display = 'none';
        document.getElementById('login-screen').style.display = 'flex';
    }
};

document.getElementById('enter-btn').addEventListener('click', () => {
    const nameInput = document.getElementById('username').value.trim();
    if (nameInput) {
        currentUser = nameInput;
        localStorage.setItem('aums_user', nameInput);
        localStorage.setItem('aums_time', new Date().getTime());
        initApp();
    }
});

function initApp() {
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('main-screen').style.display = 'flex';
    document.getElementById('user-display').innerText = `کاربر: ${currentUser}`;
    renderRoomsList();
    subscribeToAllRooms();
}

// --- مدیریت Realtime اتاق‌ها ---
function subscribeToAllRooms() {
    _supabase.channel('public:rooms')
        .on('postgres_changes', { event: '*', table: 'rooms' }, () => {
            renderRoomsList();
        }).subscribe();
}

async function renderRoomsList() {
    const { data: rooms } = await _supabase.from('rooms').select('*').eq('status', 'waiting');
    const listCont = document.getElementById('rooms-list');
    listCont.innerHTML = rooms.length === 0 ? '<p>اتاقی یافت نشد...</p>' : '';
    
    rooms.forEach(room => {
        const div = document.createElement('div');
        div.className = 'room-item';
        div.innerHTML = `<span>${room.creator} (${getGameName(room.type)})</span><button onclick="joinRoom('${room.id}')" class="user-badge">ورود</button>`;
        listCont.appendChild(div);
    });
}

// --- ساخت و ورود به اتاق ---
async function createRoom(gameType) {
    const boardSize = (gameType === 'tic-tac-toe-3') ? 9 : 49;
    let boardData = Array(boardSize).fill("");
    if (gameType === 'minesweeper') boardData = generateMines();

    const { data, error } = await _supabase.from('rooms').insert([{
        creator: currentUser,
        type: gameType,
        status: 'waiting',
        board: boardData,
        turn: 'X'
    }]).select();

    if (!error) {
        currentRoomId = data[0].id;
        mySymbol = 'X';
        enterGameUI(gameType);
        subscribeToCurrentRoom();
        sendToTelegram(currentUser, getGameName(gameType));
    }
}

async function joinRoom(id) {
    const { data: room } = await _supabase.from('rooms').select('*').eq('id', id).single();
    if (room) {
        await _supabase.from('rooms').update({ opponent: currentUser, status: 'playing' }).eq('id', id);
        currentRoomId = id;
        mySymbol = 'O';
        enterGameUI(room.type);
        subscribeToCurrentRoom();
    }
}

function subscribeToCurrentRoom() {
    _supabase.channel(`room_${currentRoomId}`)
        .on('postgres_changes', { event: 'UPDATE', table: 'rooms', filter: `id=eq.${currentRoomId}` }, payload => {
            updateGameStatus(payload.new);
        }).subscribe();
}

// --- منطق بازی و جاذبه دوز ۴ تایی ---
async function handleMove(index) {
    const { data: room } = await _supabase.from('rooms').select('*').eq('id', currentRoomId).single();
    if (room.status !== 'playing' || room.turn !== mySymbol) return;

    let targetIndex = index;
    let newBoard = [...room.board];

    if (room.type === 'tic-tac-toe-4') {
        const col = index % 7;
        targetIndex = -1;
        for (let r = 6; r >= 0; r--) {
            if (newBoard[r * 7 + col] === "") {
                targetIndex = r * 7 + col;
                break;
            }
        }
    }

    if (targetIndex === -1 || newBoard[targetIndex] !== "") return;

    newBoard[targetIndex] = mySymbol;
    const nextTurn = mySymbol === 'X' ? 'O' : 'X';
    await _supabase.from('rooms').update({ board: newBoard, turn: nextTurn }).eq('id', currentRoomId);
}

function updateGameStatus(room) {
    // نمایش بازیکنان
    document.getElementById('p1-name').innerText = room.creator;
    document.getElementById('p2-name').innerText = room.opponent || "در انتظار...";
    
    // آپدیت بورد
    const cells = document.querySelectorAll('.cell');
    room.board.forEach((val, i) => {
        cells[i].innerText = val;
        cells[i].className = `cell ${val.toLowerCase()}`;
    });

    // مدیریت تایمر (فقط وقتی دو نفر هستند)
    if (room.status === 'playing') {
        startTimer(room.turn);
        document.getElementById('turn-indicator').innerText = `نوبت: ${room.turn}`;
    }
}

function startTimer(turn) {
    clearInterval(gameTimer);
    timeLeft = 30;
    document.getElementById('game-timer').innerText = timeLeft;
    gameTimer = setInterval(() => {
        timeLeft--;
        document.getElementById('game-timer').innerText = timeLeft;
        if (timeLeft <= 0) {
            clearInterval(gameTimer);
            if (mySymbol === turn) endGame("شما به دلیل پایان زمان باختید!");
        }
    }, 1000);
}

// --- توابع کمکی ---
function enterGameUI(type) {
    document.getElementById('main-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'flex';
    const container = document.getElementById('game-board-container');
    container.innerHTML = "";
    const grid = document.createElement('div');
    grid.className = (type === 'tic-tac-toe-3') ? 'grid-3x3' : 'grid-7x7';
    const count = (type === 'tic-tac-toe-3') ? 9 : 49;
    for (let i = 0; i < count; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.onclick = () => handleMove(i);
        grid.appendChild(cell);
    }
    container.appendChild(grid);
}

function getGameName(t) {
    return t === 'tic-tac-toe-3' ? 'دوز ۳' : t === 'tic-tac-toe-4' ? 'دوز ۴' : 'مین‌روب';
}

function endGame(msg) {
    document.getElementById('result-message').innerText = msg;
    document.getElementById('result-overlay').style.display = 'flex';
}

document.querySelectorAll('.game-opt').forEach(btn => btn.onclick = () => createRoom(btn.dataset.type));
document.getElementById('create-room-btn').onclick = () => document.getElementById('game-selection-modal').style.display = 'flex';
document.querySelector('.btn-close-modal').onclick = () => document.getElementById('game-selection-modal').style.display = 'none';
document.getElementById('exit-room-btn').onclick = () => location.reload();
document.getElementById('close-room-btn').onclick = () => location.reload();
                        
