const supabaseUrl = 'https://wghquruwkuilptpgpzpg.supabase.co';
const supabaseKey = 'sb_publishable_PiwI5fZNTUy24dJcDgea5w_2Y2NIYDK';
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

let currentUser = "";
let currentRoomId = null;
let mySymbol = ""; 
let gameTimer = null;
let timeLeft = 30;

// --- شروع برنامه و احراز هویت ---
window.onload = () => {
    const savedName = localStorage.getItem('aums_user');
    const savedTime = localStorage.getItem('aums_time');
    if (savedName && savedTime && (new Date().getTime() - savedTime < 86400000)) {
        currentUser = savedName;
        initApp();
    } else {
        document.getElementById('loading-screen').style.display = 'none';
        document.getElementById('login-screen').style.display = 'flex';
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
    _supabase.channel('lobby').on('postgres_changes', { event: '*', table: 'rooms' }, () => fetchRooms()).subscribe();
    // اجرای پاکسازی اتاق‌های قدیمی هر ۶۰ ثانیه یکبار
    setInterval(cleanOldRooms, 60000);
}

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.style.display = 'none');
    document.getElementById(id).style.display = 'flex';
}

// --- مدیریت اتاق‌ها ---
async function fetchRooms() {
    const { data } = await _supabase.from('rooms').select('*').eq('status', 'waiting');
    const container = document.getElementById('rooms-list');
    container.innerHTML = "";
    document.getElementById('room-count').innerText = data ? data.length : 0;
    data?.forEach(room => {
        const div = document.createElement('div');
        div.className = 'room-item';
        div.innerHTML = `<div><strong>${room.creator}</strong><br><small>${getGameName(room.type)}</small></div>
                         <button class="btn-add-room" onclick="joinRoom('${room.id}')">نبرد</button>`;
        container.appendChild(div);
    });
}

async function createRoom(type) {
    const size = type === 'tic-tac-toe-3' ? 9 : 49;
    let boardData = type === 'minesweeper' ? generateMines() : Array(size).fill("");
    
    const { data, error } = await _supabase.from('rooms').insert([{
        creator: currentUser,
        type: type,
        status: 'waiting',
        board: boardData,
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
    const { error } = await _supabase.from('rooms').update({ 
        opponent: currentUser, 
        status: 'playing',
        last_activity: new Date().toISOString()
    }).eq('id', id).eq('status', 'waiting');

    if (!error) {
        currentRoomId = id;
        mySymbol = 'O';
        const { data } = await _supabase.from('rooms').select('*').eq('id', id).single();
        setupGameUI(data.type);
        subscribeToRoom();
    }
}

function subscribeToRoom() {
    _supabase.channel(`room_${currentRoomId}`)
        .on('postgres_changes', { event: 'UPDATE', table: 'rooms', filter: `id=eq.${currentRoomId}` }, 
        payload => updateUI(payload.new))
        .on('postgres_changes', { event: 'DELETE', table: 'rooms', filter: `id=eq.${currentRoomId}` }, 
        () => location.reload())
        .subscribe();
}

// --- منطق بازی‌ها ---
function generateMines() {
    let board = Array(49).fill({ type: 'empty', revealed: false });
    let mines = 0;
    while (mines < 15) {
        let idx = Math.floor(Math.random() * 49);
        if (board[idx].type !== 'mine') {
            board[idx] = { type: 'mine', revealed: false };
            mines++;
        }
    }
    // محاسبه اعداد اطراف مین
    return board.map((cell, i) => {
        if (cell.type === 'mine') return cell;
        let count = 0;
        const neighbors = [-8, -7, -6, -1, 1, 6, 7, 8];
        neighbors.forEach(n => {
            let ni = i + n;
            if (ni >= 0 && ni < 49 && board[ni]?.type === 'mine') count++;
        });
        return { type: 'number', value: count, revealed: false };
    });
}

async function handleMove(idx) {
    const { data: room } = await _supabase.from('rooms').select('*').eq('id', currentRoomId).single();
    if (room.status !== 'playing' || room.turn !== mySymbol) return;

    let newBoard = [...room.board];
    let nextTurn = room.turn === 'X' ? 'O' : 'X';

    if (room.type === 'tic-tac-toe-4') {
        const col = idx % 7;
        idx = -1;
        for (let r = 6; r >= 0; r--) {
            if (newBoard[r * 7 + col] === "") { idx = r * 7 + col; break; }
        }
    }

    if (idx === -1 || (room.type !== 'minesweeper' && newBoard[idx] !== "")) return;

    if (room.type === 'minesweeper') {
        if (newBoard[idx].revealed) return;
        newBoard[idx].revealed = true;
        if (newBoard[idx].type === 'mine') {
            endGame(`بمب منفجر شد! ${mySymbol === 'X' ? 'O' : 'X'} برنده شد.`);
            await _supabase.from('rooms').update({ status: 'finished' }).eq('id', currentRoomId);
            return;
        }
    } else {
        newBoard[idx] = mySymbol;
    }

    await _supabase.from('rooms').update({ 
        board: newBoard, 
        turn: nextTurn,
        last_activity: new Date().toISOString()
    }).eq('id', currentRoomId);

    checkWin(newBoard, room.type);
}

function updateUI(room) {
    if (room.status === 'finished') return;
    document.getElementById('p1-name').innerText = room.creator;
    document.getElementById('p2-name').innerText = room.opponent || "در انتظار...";
    
    const cells = document.querySelectorAll('.cell');
    room.board.forEach((val, i) => {
        if (room.type === 'minesweeper') {
            if (val.revealed) {
                cells[i].classList.add('revealed');
                cells[i].innerText = val.type === 'mine' ? '💣' : (val.value || '');
                if (val.type === 'mine') cells[i].classList.add('bomb');
            }
        } else {
            cells[i].innerText = val;
            cells[i].className = `cell ${val.toLowerCase()}`;
        }
    });

    if (room.status === 'playing') {
        document.getElementById('p1-card').classList.toggle('active', room.turn === 'X');
        document.getElementById('p2-card').classList.toggle('active', room.turn === 'O');
        document.getElementById('turn-status').innerText = `نوبت ${room.turn}`;
        startTimer(room.turn);
    }
}

// --- توابع کمکی ---
function startTimer(turn) {
    clearInterval(gameTimer);
    timeLeft = 30;
    gameTimer = setInterval(() => {
        timeLeft--;
        document.getElementById('game-timer').innerText = timeLeft;
        if (timeLeft <= 0) {
            clearInterval(gameTimer);
            if (mySymbol === turn) endGame("زمان تمام شد! حریف برنده شد.");
        }
    }, 1000);
}

function checkWin(board, type) {
    // منطق چک کردن برنده دوز ساده (باید پیاده‌سازی شود)
    // اگر برنده بود: endGame(winner + " برنده شد!");
}

async function cleanOldRooms() {
    await _supabase.rpc('delete_old_rooms');
}

function setupGameUI(type) {
    showScreen('game-screen');
    const container = document.getElementById('board-container');
    container.innerHTML = "";
    const grid = document.createElement('div');
    grid.className = type === 'tic-tac-toe-3' ? 'grid-3x3' : 'grid-7x7';
    for (let i = 0; i < (type === 'tic-tac-toe-3' ? 9 : 49); i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.onclick = () => handleMove(i);
        grid.appendChild(cell);
    }
    container.appendChild(grid);
}

function getGameName(t) {
    const names = { 'tic-tac-toe-3': 'دوز ۳', 'tic-tac-toe-4': 'دوز ۴', 'minesweeper': 'مین‌روب' };
    return names[t];
}

function sendToTelegram(user, game) {
    const url = "https://script.google.com/macros/s/AKfycbwcXTA2S7hRT3xnC7GPNXV6hg2uMgzyPcS7OElMYGZAwwCzVBiX2niPEduQYpnhKEbZ/exec";
    fetch(url, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ user, game, action: 'new_room' }) });
}

function endGame(msg) {
    clearInterval(gameTimer);
    document.getElementById('result-message').innerText = msg;
    document.getElementById('result-overlay').style.display = 'flex';
}

document.querySelectorAll('.opt-card').forEach(btn => btn.onclick = () => createRoom(btn.dataset.type));
document.getElementById('create-room-btn').onclick = () => document.getElementById('game-modal').style.display = 'flex';
document.getElementById('exit-room-btn').onclick = () => location.reload();
document.getElementById('close-room-btn').onclick = () => location.reload();
            
