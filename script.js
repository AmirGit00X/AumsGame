const supabaseUrl = 'https://wghquruwkuilptpgpzpg.supabase.co';
const supabaseKey = 'sb_publishable_PiwI5fZNTUy24dJcDgea5w_2Y2NIYDK';
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

let currentUser = "";
let currentRoomId = null;
let mySymbol = ""; 
let gameTimer = null;
let timeLeft = 30;

// --- شروع برنامه و مدیریت حافظه ---
window.onload = () => {
    const savedName = localStorage.getItem('aums_user');
    const savedTime = localStorage.getItem('aums_time');
    const now = new Date().getTime();

    if (savedName && savedTime && (now - savedTime < 24 * 60 * 60 * 1000)) {
        currentUser = savedName;
        initApp();
    } else {
        showScreen('login-screen');
    }
};

document.getElementById('enter-btn').onclick = () => {
    const name = document.getElementById('username').value.trim();
    if (name) {
        currentUser = name;
        localStorage.setItem('aums_user', name);
        localStorage.setItem('aums_time', new Date().getTime());
        initApp();
    }
};

function initApp() {
    showScreen('main-screen');
    document.getElementById('user-display').innerText = currentUser;
    fetchRooms();
    subscribeToLobby();
}

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.style.display = 'none');
    document.getElementById(id).style.display = 'flex';
}

// --- مدیریت Realtime لابی ---
function subscribeToLobby() {
    _supabase.channel('lobby')
        .on('postgres_changes', { event: '*', table: 'rooms' }, () => fetchRooms())
        .subscribe();
}

async function fetchRooms() {
    const { data } = await _supabase.from('rooms')
        .select('*')
        .eq('status', 'waiting')
        .order('created_at', { ascending: false });
    
    const container = document.getElementById('rooms-list');
    container.innerHTML = "";
    data?.forEach(room => {
        const el = document.createElement('div');
        el.className = 'room-item';
        el.innerHTML = `
            <div>
                <strong>${room.creator}</strong><br>
                <small>${getGameName(room.type)}</small>
            </div>
            <button class="btn-add-room" onclick="joinRoom('${room.id}')">ورود</button>
        `;
        container.appendChild(el);
    });
}

// --- ساخت و مدیریت اتاق ---
async function createRoom(type) {
    const boardSize = type === 'tic-tac-toe-3' ? 9 : 49;
    const { data, error } = await _supabase.from('rooms').insert([{
        creator: currentUser,
        type: type,
        status: 'waiting',
        board: Array(boardSize).fill(""),
        turn: 'X',
        last_activity: new Date().toISOString()
    }]).select();

    if (!error) {
        currentRoomId = data[0].id;
        mySymbol = 'X';
        setupGameUI(type);
        subscribeToRoom();
        sendToTelegram(currentUser, getGameName(type));
    }
}

async function joinRoom(id) {
    const { data: room } = await _supabase.from('rooms').select('*').eq('id', id).single();
    if (room && room.status === 'waiting') {
        await _supabase.from('rooms').update({ 
            opponent: currentUser, 
            status: 'playing',
            last_activity: new Date().toISOString()
        }).eq('id', id);
        
        currentRoomId = id;
        mySymbol = 'O';
        setupGameUI(room.type);
        subscribeToRoom();
    }
}

function subscribeToRoom() {
    _supabase.channel(`room_${currentRoomId}`)
        .on('postgres_changes', { event: 'UPDATE', table: 'rooms', filter: `id=eq.${currentRoomId}` }, 
        payload => updateUI(payload.new))
        .subscribe();
}

// --- منطق اصلی بازی و حرکات ---
async function handleMove(idx) {
    const { data: room } = await _supabase.from('rooms').select('*').eq('id', currentRoomId).single();
    if (room.status !== 'playing' || room.turn !== mySymbol) return;

    let newBoard = [...room.board];
    let finalIdx = idx;

    // منطق جاذبه برای دوز ۴ تایی (7x7)
    if (room.type === 'tic-tac-toe-4') {
        const col = idx % 7;
        finalIdx = -1;
        for (let r = 6; r >= 0; r--) {
            if (newBoard[r * 7 + col] === "") {
                finalIdx = r * 7 + col;
                break;
            }
        }
    }

    if (finalIdx === -1 || newBoard[finalIdx] !== "") return;

    newBoard[finalIdx] = mySymbol;
    await _supabase.from('rooms').update({ 
        board: newBoard, 
        turn: room.turn === 'X' ? 'O' : 'X',
        last_activity: new Date().toISOString()
    }).eq('id', currentRoomId);
}

function updateUI(room) {
    document.getElementById('p1-name').innerText = room.creator;
    document.getElementById('p2-name').innerText = room.opponent || "در انتظار...";
    
    const cells = document.querySelectorAll('.cell');
    room.board.forEach((val, i) => {
        cells[i].innerText = val;
        cells[i].className = `cell ${val ? val.toLowerCase() : ''}`;
    });

    if (room.status === 'playing') {
        document.getElementById('p1-card').classList.toggle('active', room.turn === 'X');
        document.getElementById('p2-card').classList.toggle('active', room.turn === 'O');
        document.getElementById('turn-status').innerText = `نوبت ${room.turn}`;
        startTimer(room.turn);
    }
}

function startTimer(turn) {
    clearInterval(gameTimer);
    timeLeft = 30;
    gameTimer = setInterval(() => {
        timeLeft--;
        document.getElementById('game-timer').innerText = timeLeft;
        if (timeLeft <= 0) {
            clearInterval(gameTimer);
            if (mySymbol === turn) endGame("زمان شما تمام شد! باختید.");
        }
    }, 1000);
}

function setupGameUI(type) {
    showScreen('game-screen');
    const container = document.getElementById('board-container');
    container.innerHTML = "";
    const grid = document.createElement('div');
    grid.className = type === 'tic-tac-toe-3' ? 'grid-3x3' : 'grid-7x7';
    const size = type === 'tic-tac-toe-3' ? 9 : 49;
    
    for (let i = 0; i < size; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.onclick = () => handleMove(i);
        grid.appendChild(cell);
    }
    container.appendChild(grid);
}

function getGameName(t) {
    return t === 'tic-tac-toe-3' ? 'دوز ۳ تایی' : t === 'tic-tac-toe-4' ? 'دوز ۴ تایی' : 'مین‌روب';
}

function sendToTelegram(user, game) {
    const url = "https://script.google.com/macros/s/AKfycbwcXTA2S7hRT3xnC7GPNXV6hg2uMgzyPcS7OElMYGZAwwCzVBiX2niPEduQYpnhKEbZ/exec";
    fetch(url, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ user, game, action: 'new_room' }) });
}

function endGame(msg) {
    document.getElementById('result-message').innerText = msg;
    document.getElementById('result-overlay').style.display = 'flex';
}

// اینونت‌ها
document.querySelectorAll('.opt-card').forEach(btn => btn.onclick = () => createRoom(btn.dataset.type));
document.getElementById('create-room-btn').onclick = () => document.getElementById('game-modal').style.display = 'flex';
document.querySelector('.btn-cancel').onclick = () => document.getElementById('game-modal').style.display = 'none';
document.getElementById('exit-room-btn').onclick = () => location.reload();
document.getElementById('close-room-btn').onclick = () => location.reload();
    
