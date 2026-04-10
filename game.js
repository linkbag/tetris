'use strict';

// ============================================================
// CONSTANTS
// ============================================================

const COLS = 10;
const ROWS = 20;
const CELL = 30; // px per cell

// Piece fill, highlight, shadow colors
const COLORS = {
  I: ['#00d8ef', '#80ecf7', '#008fa0'],
  O: ['#f0d000', '#f8e870', '#a08800'],
  T: ['#a020e0', '#cc80f0', '#6010a0'],
  S: ['#10d040', '#80e8a0', '#088028'],
  Z: ['#e82020', '#f08080', '#a01010'],
  J: ['#2040e8', '#8098f0', '#1028a0'],
  L: ['#e08020', '#f0c080', '#a05010'],
};

// SRS rotation states — cells as [row, col] within a bounding box
const SHAPES = {
  I: [
    [[1,0],[1,1],[1,2],[1,3]],
    [[0,2],[1,2],[2,2],[3,2]],
    [[2,0],[2,1],[2,2],[2,3]],
    [[0,1],[1,1],[2,1],[3,1]],
  ],
  O: [
    [[0,0],[0,1],[1,0],[1,1]],
    [[0,0],[0,1],[1,0],[1,1]],
    [[0,0],[0,1],[1,0],[1,1]],
    [[0,0],[0,1],[1,0],[1,1]],
  ],
  T: [
    [[0,1],[1,0],[1,1],[1,2]],
    [[0,1],[1,1],[1,2],[2,1]],
    [[1,0],[1,1],[1,2],[2,1]],
    [[0,1],[1,0],[1,1],[2,1]],
  ],
  S: [
    [[0,1],[0,2],[1,0],[1,1]],
    [[0,1],[1,1],[1,2],[2,2]],
    [[1,1],[1,2],[2,0],[2,1]],
    [[0,0],[1,0],[1,1],[2,1]],
  ],
  Z: [
    [[0,0],[0,1],[1,1],[1,2]],
    [[0,2],[1,1],[1,2],[2,1]],
    [[1,0],[1,1],[2,1],[2,2]],
    [[0,1],[1,0],[1,1],[2,0]],
  ],
  J: [
    [[0,0],[1,0],[1,1],[1,2]],
    [[0,1],[0,2],[1,1],[2,1]],
    [[1,0],[1,1],[1,2],[2,2]],
    [[0,1],[1,1],[2,0],[2,1]],
  ],
  L: [
    [[0,2],[1,0],[1,1],[1,2]],
    [[0,1],[1,1],[2,1],[2,2]],
    [[1,0],[1,1],[1,2],[2,0]],
    [[0,0],[0,1],[1,1],[2,1]],
  ],
};

// SRS Wall Kicks — (dx, dy) where dx=right, dy=up (SRS coords)
// When applying to grid: col += dx, row -= dy
const KICKS_JLSTZ = {
  '0>R': [[ 0,0],[-1,0],[-1, 1],[ 0,-2],[-1,-2]],
  'R>0': [[ 0,0],[ 1,0],[ 1,-1],[ 0, 2],[ 1, 2]],
  'R>2': [[ 0,0],[ 1,0],[ 1,-1],[ 0, 2],[ 1, 2]],
  '2>R': [[ 0,0],[-1,0],[-1, 1],[ 0,-2],[-1,-2]],
  '2>L': [[ 0,0],[ 1,0],[ 1, 1],[ 0,-2],[ 1,-2]],
  'L>2': [[ 0,0],[-1,0],[-1,-1],[ 0, 2],[-1, 2]],
  'L>0': [[ 0,0],[-1,0],[-1,-1],[ 0, 2],[-1, 2]],
  '0>L': [[ 0,0],[ 1,0],[ 1, 1],[ 0,-2],[ 1,-2]],
};

const KICKS_I = {
  '0>R': [[ 0,0],[-2,0],[ 1,0],[-2,-1],[ 1, 2]],
  'R>0': [[ 0,0],[ 2,0],[-1,0],[ 2, 1],[-1,-2]],
  'R>2': [[ 0,0],[-1,0],[ 2,0],[-1, 2],[ 2,-1]],
  '2>R': [[ 0,0],[ 1,0],[-2,0],[ 1,-2],[-2, 1]],
  '2>L': [[ 0,0],[ 2,0],[-1,0],[ 2, 1],[-1,-2]],
  'L>2': [[ 0,0],[-2,0],[ 1,0],[-2,-1],[ 1, 2]],
  'L>0': [[ 0,0],[ 1,0],[-2,0],[ 1,-2],[-2, 1]],
  '0>L': [[ 0,0],[-1,0],[ 2,0],[-1, 2],[ 2,-1]],
};

const ROT_NAMES = ['0', 'R', '2', 'L'];

// Level gravity: milliseconds per one automatic drop step
const GRAVITY_MS = [
  0, 1000, 793, 618, 473, 355,
  262, 190, 135, 94, 64,
  50, 38, 28, 20, 15,
];

function gravityAt(level) {
  return GRAVITY_MS[Math.min(level, GRAVITY_MS.length - 1)];
}

const LINE_SCORES  = [0, 100, 300, 500, 800];
const CLEAR_ANIM_MS = 350;
const LOCK_DELAY_MS = 500;
const MAX_LOCK_MOVES = 15;

// ============================================================
// PIECE
// ============================================================

class Piece {
  constructor(type) {
    this.type = type;
    this.rot  = 0;
    // Standard SRS spawn column (bounding-box left edge)
    this.col = type === 'O' ? 4 : 3;
    // row=0 places the bounding box at top; I piece has its cells at bbox row 1
    this.row = 0;
  }

  cells(rot = this.rot) {
    return SHAPES[this.type][rot];
  }

  absCells(rot = this.rot, row = this.row, col = this.col) {
    return this.cells(rot).map(([r, c]) => [row + r, col + c]);
  }

  clone() {
    const p = new Piece(this.type);
    p.rot = this.rot;
    p.row = this.row;
    p.col = this.col;
    return p;
  }
}

// ============================================================
// GAME LOGIC
// ============================================================

const State = { MENU: 0, PLAYING: 1, PAUSED: 2, CLEARING: 3, OVER: 4 };

class TetrisGame {
  constructor() {
    this.best  = parseInt(localStorage.getItem('tetris-best') || '0', 10);
    this._reset();
  }

  _reset() {
    this.board      = Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
    this.state      = State.MENU;
    this.current    = null;
    this.held       = null;
    this.canHold    = true;
    this.bag        = [];
    this.nextQueue  = [];
    this.score      = 0;
    this.level      = 1;
    this.lines      = 0;
    this.combo      = 0;
    this.b2b        = false;   // back-to-back Tetris
    this.newBest    = false;   // set true when a new high score is achieved
    this.clearRows  = [];      // rows currently being cleared
    this.clearTimer = 0;
    this.gravTimer  = 0;
    this.lockTimer  = 0;
    this.lockMoves  = 0;
    this.locking    = false;
    this._fillBag();
    for (let i = 0; i < 5; i++) this.nextQueue.push(this._drawPiece());
  }

  // ---- bag randomizer ----
  _fillBag() {
    const bag = ['I','O','T','S','Z','J','L'];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    this.bag.push(...bag);
  }

  _drawPiece() {
    if (this.bag.length === 0) this._fillBag();
    return this.bag.shift();
  }

  _nextType() {
    const t = this.nextQueue.shift();
    this.nextQueue.push(this._drawPiece());
    return t;
  }

  // ---- validity ----
  _valid(piece, dRow = 0, dCol = 0, rot = piece.rot) {
    for (const [r, c] of piece.absCells(rot, piece.row + dRow, piece.col + dCol)) {
      if (c < 0 || c >= COLS || r >= ROWS) return false;
      if (r >= 0 && this.board[r][c] !== null) return false;
    }
    return true;
  }

  // ---- spawn ----
  _spawn() {
    this.current  = new Piece(this._nextType());
    this.canHold  = true;
    this.locking  = false;
    this.lockTimer = 0;
    this.lockMoves = 0;
    if (!this._valid(this.current)) {
      this._gameOver();
      return false;
    }
    return true;
  }

  // ---- movement ----
  moveLeft()  { return this._shift(0, -1); }
  moveRight() { return this._shift(0,  1); }

  _shift(dRow, dCol) {
    if (!this.current || this.state !== State.PLAYING) return false;
    if (this._valid(this.current, dRow, dCol)) {
      this.current.row += dRow;
      this.current.col += dCol;
      this._onMove();
      return true;
    }
    return false;
  }

  softDrop() {
    if (!this.current || this.state !== State.PLAYING) return;
    if (this._valid(this.current, 1, 0)) {
      this.current.row++;
      this.gravTimer = 0;
      this.score++;
    }
  }

  hardDrop() {
    if (!this.current || this.state !== State.PLAYING) return;
    let n = 0;
    while (this._valid(this.current, 1, 0)) {
      this.current.row++;
      n++;
    }
    this.score += n * 2;
    this._lock();
  }

  rotate(dir) {
    if (!this.current || this.state !== State.PLAYING) return false;
    const from = this.current.rot;
    const to   = (from + (dir > 0 ? 1 : 3)) % 4;
    const key  = `${ROT_NAMES[from]}>${ROT_NAMES[to]}`;
    const kicks = this.current.type === 'I' ? KICKS_I[key]
                : this.current.type === 'O' ? [[0, 0]]
                : KICKS_JLSTZ[key];
    for (const [dx, dy] of kicks) {
      // dx = col offset (right), dy = SRS y (up) → row offset = -dy
      if (this._valid(this.current, -dy, dx, to)) {
        this.current.rot  = to;
        this.current.row += -dy;
        this.current.col += dx;
        this._onMove();
        return true;
      }
    }
    return false;
  }

  _onMove() {
    if (this.locking && this.lockMoves < MAX_LOCK_MOVES) {
      this.lockTimer = 0;
      this.lockMoves++;
    }
  }

  // ---- hold ----
  hold() {
    if (!this.current || !this.canHold || this.state !== State.PLAYING) return;
    this.canHold = false;
    if (this.held === null) {
      this.held = this.current.type;
      this._spawn();
    } else {
      const tmp        = this.held;
      this.held        = this.current.type;
      this.current     = new Piece(tmp);
      this.locking     = false;
      this.lockTimer   = 0;
      this.lockMoves   = 0;
      if (!this._valid(this.current)) this._gameOver();
    }
  }

  // ---- ghost ----
  ghost() {
    if (!this.current) return null;
    const g = this.current.clone();
    while (this._valid(g, 1, 0)) g.row++;
    return g;
  }

  // ---- locking ----
  _lock() {
    const p = this.current;
    if (!p) return;
    for (const [r, c] of p.absCells()) {
      if (r >= 0) this.board[r][c] = p.type;
    }
    this.current = null;

    // find full rows
    const full = [];
    for (let r = ROWS - 1; r >= 0; r--) {
      if (this.board[r].every(cell => cell !== null)) full.push(r);
    }

    if (full.length > 0) {
      const n = full.length;
      let pts = LINE_SCORES[n] * this.level;

      // back-to-back Tetris bonus
      if (n === 4) {
        if (this.b2b) pts = Math.floor(pts * 1.5);
        this.b2b = true;
      } else {
        this.b2b = false;
      }

      // combo
      this.combo++;
      if (this.combo > 1) pts += 50 * (this.combo - 1) * this.level;

      this.score += pts;
      this.lines += n;
      this.level  = Math.floor(this.lines / 10) + 1;

      if (this.score > this.best) {
        this.best    = this.score;
        this.newBest = true;
        localStorage.setItem('tetris-best', this.best);
      }

      this.clearRows  = full;
      this.clearTimer = CLEAR_ANIM_MS;
      this.state      = State.CLEARING;
    } else {
      this.combo = 0;
      this._spawn();
    }
  }

  _clearLines() {
    for (const r of this.clearRows.slice().sort((a, b) => b - a)) {
      this.board.splice(r, 1);
      this.board.unshift(new Array(COLS).fill(null));
    }
    this.clearRows = [];
    this.state = State.PLAYING;
    this._spawn();
  }

  _gameOver() {
    this.state = State.OVER;
    // newBest was already set in _lock() whenever the score exceeded the record
  }

  // ---- main update ----
  update(dt) {
    if (this.state === State.CLEARING) {
      this.clearTimer -= dt;
      if (this.clearTimer <= 0) this._clearLines();
      return;
    }

    if (this.state !== State.PLAYING || !this.current) return;

    const onGround = !this._valid(this.current, 1, 0);

    if (onGround) {
      if (!this.locking) { this.locking = true; this.lockTimer = 0; }
      this.lockTimer += dt;
      if (this.lockTimer >= LOCK_DELAY_MS) this._lock();
    } else {
      this.locking   = false;
      this.lockTimer = 0;
      this.gravTimer += dt;
      const g = gravityAt(this.level);
      while (this.gravTimer >= g) {
        this.gravTimer -= g;
        if (this._valid(this.current, 1, 0)) {
          this.current.row++;
        } else {
          this.gravTimer = 0; // drain timer — piece just hit ground
          break;
        }
      }
    }
  }

  // ---- control ----
  start() {
    this._reset();
    this.state = State.PLAYING;
    this._spawn();
  }

  togglePause() {
    if (this.state === State.PLAYING)  this.state = State.PAUSED;
    else if (this.state === State.PAUSED) this.state = State.PLAYING;
  }
}

// ============================================================
// RENDERER
// ============================================================

class Renderer {
  constructor(game) {
    this.game = game;

    this.boardCtx = document.getElementById('board-canvas').getContext('2d');
    this.holdCtx  = document.getElementById('hold-canvas').getContext('2d');
    this.nextCtx  = document.getElementById('next-canvas').getContext('2d');

    this.overlay    = document.getElementById('overlay');
    this.oTitle     = document.getElementById('overlay-title');
    this.oSub       = document.getElementById('overlay-sub');
    this.oScoreDisp = document.getElementById('overlay-score-display');
    this.oPrompt    = document.getElementById('overlay-prompt');

    this.scoreEl = document.getElementById('score');
    this.bestEl  = document.getElementById('best');
    this.levelEl = document.getElementById('level');
    this.linesEl = document.getElementById('lines');
  }

  // ---- cell drawing ----
  _cell(ctx, x, y, type, alpha = 1, s = CELL) {
    const [fill, hi, sh] = COLORS[type];
    const brd = Math.max(1, Math.round(s * 0.08)); // border thickness scales with cell size

    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, s, s);

    // top-left highlight
    ctx.fillStyle = hi;
    ctx.fillRect(x,         y,             s,   brd);
    ctx.fillRect(x,         y,             brd, s);

    // bottom-right shadow
    ctx.fillStyle = sh;
    ctx.fillRect(x,         y + s - brd,   s,   brd);
    ctx.fillRect(x + s - brd, y,           brd, s);

    // inner face
    ctx.fillStyle = fill;
    ctx.fillRect(x + brd, y + brd, s - brd * 2, s - brd * 2);

    ctx.globalAlpha = 1;
  }

  _ghostCell(ctx, x, y, type) {
    const [fill] = COLORS[type];
    const s = CELL;
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = fill;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, s - 2, s - 2);
    ctx.globalAlpha = 1;
  }

  // ---- board ----
  _drawBoard() {
    const ctx = this.boardCtx;
    const { game } = this;

    // background
    ctx.fillStyle = '#080812';
    ctx.fillRect(0, 0, COLS * CELL, ROWS * CELL);

    // subtle grid
    ctx.strokeStyle = 'rgba(30, 32, 64, 0.6)';
    ctx.lineWidth = 0.5;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        ctx.strokeRect(c * CELL, r * CELL, CELL, CELL);
      }
    }

    // locked cells (with clear animation)
    const { board, clearRows, clearTimer } = game;
    for (let r = 0; r < ROWS; r++) {
      const clearing = clearRows.includes(r);
      for (let c = 0; c < COLS; c++) {
        const type = board[r][c];
        if (!type) continue;
        const x = c * CELL, y = r * CELL;
        if (clearing) {
          const t  = clearTimer / CLEAR_ANIM_MS;
          const fl = Math.sin(t * Math.PI * 5) > 0;
          if (fl) {
            ctx.globalAlpha = t * 0.8 + 0.2;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(x, y, CELL, CELL);
            ctx.globalAlpha = 1;
          } else {
            this._cell(ctx, x, y, type, t * 0.6 + 0.4);
          }
        } else {
          this._cell(ctx, x, y, type);
        }
      }
    }

    // ghost piece
    if (game.state === State.PLAYING || game.state === State.CLEARING) {
      const ghost = game.ghost();
      if (ghost) {
        for (const [r, c] of ghost.absCells()) {
          if (r >= 0) this._ghostCell(ctx, c * CELL, r * CELL, ghost.type);
        }
      }
    }

    // current piece
    const cur = game.current;
    if (cur) {
      for (const [r, c] of cur.absCells()) {
        if (r >= 0) this._cell(ctx, c * CELL, r * CELL, cur.type);
      }
    }
  }

  // ---- mini piece (hold / next) ----
  _miniPiece(ctx, cw, ch, type, alpha = 1, cellSz = CELL * 0.72) {
    if (!type) return;
    const cells = SHAPES[type][0];
    const rs = cells.map(([r]) => r), cs = cells.map(([, c]) => c);
    const pw = (Math.max(...cs) - Math.min(...cs) + 1) * cellSz;
    const ph = (Math.max(...rs) - Math.min(...rs) + 1) * cellSz;
    const ox = (cw - pw) / 2, oy = (ch - ph) / 2;
    const minR = Math.min(...rs), minC = Math.min(...cs);
    for (const [r, c] of cells) {
      this._cell(ctx, ox + (c - minC) * cellSz, oy + (r - minR) * cellSz, type, alpha, cellSz);
    }
  }

  _drawHold() {
    const ctx = this.holdCtx;
    ctx.clearRect(0, 0, 120, 80);
    const { held, canHold } = this.game;
    if (held) this._miniPiece(ctx, 120, 80, held, canHold ? 1 : 0.35);
  }

  _drawNext() {
    const ctx = this.nextCtx;
    ctx.clearRect(0, 0, 120, 400);
    const queue = this.game.nextQueue;
    const slotH = 80;
    const cellSz = CELL * 0.72;
    for (let i = 0; i < Math.min(5, queue.length); i++) {
      const alpha = i === 0 ? 1 : 0.45 + 0.09 * (4 - i);
      const cells = SHAPES[queue[i]][0];
      const rs = cells.map(([r]) => r), cs = cells.map(([, c]) => c);
      const pw = (Math.max(...cs) - Math.min(...cs) + 1) * cellSz;
      const ph = (Math.max(...rs) - Math.min(...rs) + 1) * cellSz;
      const ox   = (120 - pw) / 2;
      const oy   = i * slotH + (slotH - ph) / 2;
      const minR = Math.min(...rs), minC = Math.min(...cs);
      for (const [r, c] of cells) {
        this._cell(ctx, ox + (c - minC) * cellSz, oy + (r - minR) * cellSz, queue[i], alpha, cellSz);
      }
    }
  }

  // ---- HUD ----
  _updateHUD() {
    const g = this.game;
    this.scoreEl.textContent = g.score.toLocaleString();
    this.bestEl.textContent  = g.best.toLocaleString();
    this.levelEl.textContent = g.level;
    this.linesEl.textContent = g.lines;
  }

  // ---- overlay ----
  _updateOverlay() {
    const { state, score } = this.game;

    if (state === State.PLAYING || state === State.CLEARING) {
      this.overlay.classList.add('hidden');
      return;
    }

    this.overlay.classList.remove('hidden');

    if (state === State.MENU) {
      this.oTitle.textContent     = 'TETRIS';
      this.oSub.textContent       = '';
      this.oScoreDisp.innerHTML   = '';
      this.oPrompt.innerHTML      = 'Press <strong>ENTER</strong> or <strong>SPACE</strong> to Start';
    } else if (state === State.PAUSED) {
      this.oTitle.textContent     = 'PAUSED';
      this.oSub.textContent       = '';
      this.oScoreDisp.innerHTML   = '';
      this.oPrompt.innerHTML      = 'Press <strong>P</strong> to Resume';
    } else if (state === State.OVER) {
      this.oTitle.textContent = 'GAME OVER';
      this.oSub.textContent   = '';
      this.oScoreDisp.innerHTML = `Score: <strong>${score.toLocaleString()}</strong>` +
        (this.game.newBest ? `<br><span class="new-best">&#9733; NEW BEST &#9733;</span>` : '');
      this.oPrompt.innerHTML = 'Press <strong>ENTER</strong> or <strong>SPACE</strong> to Restart';
    }
  }

  render() {
    this._drawBoard();
    this._drawHold();
    this._drawNext();
    this._updateHUD();
    this._updateOverlay();
  }
}

// ============================================================
// INPUT
// ============================================================

class Input {
  constructor(game) {
    this.game    = game;
    this.held    = {};
    this.timers  = {};
    this.DAS     = 167;
    this.ARR     = 33;

    document.addEventListener('keydown', this._down.bind(this));
    document.addEventListener('keyup',   this._up.bind(this));
  }

  _down(e) {
    if (this.held[e.code]) return;
    this.held[e.code] = true;

    const { game } = this;

    // ---- always-active keys ----
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (game.state === State.PLAYING || game.state === State.PAUSED) {
        game.togglePause();
      }
      e.preventDefault(); return;
    }

    if (e.code === 'Enter' || e.code === 'Space') {
      if (game.state === State.MENU || game.state === State.OVER) {
        game.start();
        e.preventDefault(); return;
      }
    }

    if (game.state !== State.PLAYING) { e.preventDefault(); return; }

    // ---- in-game keys ----
    switch (e.code) {
      case 'ArrowLeft':
        game.moveLeft();
        this._startRepeat('ArrowLeft', () => game.moveLeft());
        break;
      case 'ArrowRight':
        game.moveRight();
        this._startRepeat('ArrowRight', () => game.moveRight());
        break;
      case 'ArrowDown':
        game.softDrop();
        this._startRepeat('ArrowDown', () => game.softDrop());
        break;
      case 'Space':
        game.hardDrop();
        break;
      case 'ArrowUp':
      case 'KeyX':
        game.rotate(1);
        break;
      case 'KeyZ':
      case 'ControlLeft':
      case 'ControlRight':
        game.rotate(-1);
        break;
      case 'KeyC':
      case 'ShiftLeft':
      case 'ShiftRight':
        game.hold();
        break;
    }
    e.preventDefault();
  }

  _up(e) {
    this.held[e.code] = false;
    this._stopRepeat(e.code);
  }

  _startRepeat(code, fn) {
    this._stopRepeat(code);
    this.timers[code] = setTimeout(() => {
      fn();
      this.timers[code] = setInterval(fn, this.ARR);
    }, this.DAS);
  }

  _stopRepeat(code) {
    if (this.timers[code]) {
      clearTimeout(this.timers[code]);
      clearInterval(this.timers[code]);
      delete this.timers[code];
    }
  }
}

// ============================================================
// MAIN LOOP
// ============================================================

const game     = new TetrisGame();
const renderer = new Renderer(game);
const input    = new Input(game);   // eslint-disable-line no-unused-vars

let lastTs = 0;

function loop(ts) {
  const dt = Math.min(ts - lastTs, 100); // cap at 100ms to avoid huge jumps
  lastTs = ts;
  game.update(dt);
  renderer.render();
  requestAnimationFrame(loop);
}

requestAnimationFrame(ts => { lastTs = ts; requestAnimationFrame(loop); });
