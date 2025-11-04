(function () {
    // ====== ゲーム定義（共通） ======
    const baseItems = [
        { x: 0, y: 0, emoji: "🥩", type: "fridge" },
        { x: 2, y: 0, emoji: "🥬", type: "fridge" },
        { x: 3, y: 0, emoji: "🍅", type: "fridge" },
        { x: 4, y: 0, emoji: "🫓", type: "fridge" },
        { x: 4, y: 2, emoji: "🔪", type: "fixed", name: "包丁" },
        { x: 5, y: 2, emoji: "🔥", type: "fixed", name: "火" },
        { x: 6, y: 0, emoji: "🍽️", type: "fixed", name: "提供場所" },
        { x: 8, y: 4, emoji: "🧾", type: "serve" }
    ];

    // レシピ（UI表示用は絵文字のみ／加工状態は内部フラグ）
    const BURGER_RECIPES = {
        "ハンバーガー": ["🫓", "🥩", "🥬"],
        "ベジバーガー": ["🫓", "🥬", "🍅"],
        "ミートサンド": ["🫓", "🥩"]
    };

    // ====== 状態 ======
    let spawnedItems = [], px = 1, py = 1, holding = null;
    let timer = 120, playing = false, pausedTime = null;
    let activeOrders = [];
    let score = 0;

    // 注文はクライアント生成・寿命進行（あなたのFlask設計に合わせる）
    let orderInterval = null;
    let orderUpdateInterval = null;

    // 自分のSocket ID（スコア受信の照合に使用）
    let mySid = null;

    // ====== DOM ======
    const grid = document.getElementById("grid"),
        timerEl = document.getElementById("timer"),
        orderEl = document.getElementById("orderContainer"),
        scoreEl = document.getElementById("score"),
        startBtn = document.getElementById("startBtn"),
        pauseBtn = document.getElementById("pauseBtn"),
        resumeBtn = document.getElementById("resumeBtn");

    // ====== ユーティリティ ======
    const socket = io(); // v3 クライアント必須（CDN 3.x を読み込む）
    socket.on("connect", () => { mySid = socket.id; });

    function genId() { return 's-' + Math.random().toString(36).slice(2, 9); }
    function findCell(x, y) { return [...grid.children].find(c => +c.dataset.x === x && +c.dataset.y === y); }
    function isProcessed(it) {
        if (!it) return false;
        if (it.emoji === "🥩") return it.checked && it.cooked;   // 肉：切って焼く
        if (["🥬", "🍅"].includes(it.emoji)) return it.checked;   // 野菜：切る
        return false;
    }
    function multisetsEqual(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b)) return false;
        if (a.length !== b.length) return false;
        const freq = {};
        for (const x of a) freq[x] = (freq[x] || 0) + 1;
        for (const x of b) { if (!freq[x]) return false; freq[x]--; }
        return true;
    }
    function clearAllIntervals() {
        if (orderInterval) { clearInterval(orderInterval); orderInterval = null; }
        if (orderUpdateInterval) { clearInterval(orderUpdateInterval); orderUpdateInterval = null; }
    }

    // ====== バーガー合成 ======
    function combineToBurger(x, y) {
        const plate = baseItems.find(b => b.x === x && b.y === y && b.emoji === "🍽️");
        if (!plate) return;
        const cellItems = spawnedItems.filter(it => it.x === x && it.y === y && !it.isBurger);
        const bread = cellItems.filter(it => it.emoji === "🫓");
        const processed = cellItems.filter(isProcessed);
        if (bread.length > 0 && processed.length > 0) {
            let burger = spawnedItems.find(it => it.x === x && it.y === y && it.isBurger);
            if (!burger) {
                burger = { x, y, emoji: "🍔", id: genId(), isBurger: true, contents: [] };
                spawnedItems.push(burger);
            }
            if (!burger.contents.includes("🫓")) burger.contents.push("🫓");
            processed.forEach(it => {
                if (!burger.contents.includes(it.emoji)) burger.contents.push(it.emoji);
                spawnedItems = spawnedItems.filter(s => s.id !== it.id);
            });
            // パンを1つ消費
            const idx = spawnedItems.findIndex(s => s.x === x && s.y === y && s.emoji === "🫓");
            if (idx >= 0) spawnedItems.splice(idx, 1);
        }
    }

    // ====== 描画 ======
    function renderGrid() {
        grid.innerHTML = "";
        for (let y = 0; y < 5; y++)
            for (let x = 0; x < 9; x++) {
                const cell = document.createElement("div");
                cell.className = "cell"; cell.dataset.x = x; cell.dataset.y = y;
                grid.appendChild(cell);
            }
        baseItems.forEach(it => {
            const cell = findCell(it.x, it.y);
            if (!cell) return;
            const e = document.createElement("div");
            e.className = "emoji"; e.textContent = it.emoji;
            if (it.name) e.title = it.name;
            cell.appendChild(e);
        });
        spawnedItems.forEach(it => { if (!it.isBurger) combineToBurger(it.x, it.y); });
        spawnedItems.forEach(it => {
            const cell = findCell(it.x, it.y);
            if (!cell) return;
            const e = document.createElement("div");
            e.className = "emoji"; e.textContent = it.emoji;
            if (it.checked) e.classList.add("checked");
            if (it.cooked && it.emoji === "🥩") e.classList.add("cooked");
            cell.appendChild(e);
            if (it.isBurger && it.contents) {
                const tip = document.createElement("div");
                tip.className = "burger-tooltip";
                tip.textContent = it.contents.join(",");
                cell.appendChild(tip);
            }
        });
        const playerEl = document.createElement("div");
        playerEl.className = "player";
        const pcell = findCell(px, py);
        if (pcell) pcell.appendChild(playerEl);
        if (holding && pcell) {
            const held = document.createElement("div");
            held.className = "emoji"; held.textContent = holding.emoji;
            if (holding.checked) held.classList.add("checked");
            if (holding.cooked && holding.emoji === "🥩") held.classList.add("cooked");
            held.style.zIndex = 60; pcell.appendChild(held);
            if (holding.isBurger && holding.contents) {
                const tip = document.createElement("div");
                tip.className = "burger-tooltip"; tip.textContent = holding.contents.join(",");
                pcell.appendChild(tip);
            }
        }
        scoreEl.textContent = `スコア: ${score}`;
        timerEl.textContent = timer > 0 ? timer : "終了";
    }

    // ====== 操作 ======
    function handleDAction() {
        if (!playing) return;
        if (!holding) {
            const idx = spawnedItems.findIndex(it => it.x === px && it.y === py);
            if (idx >= 0) { holding = spawnedItems.splice(idx, 1)[0]; renderGrid(); return; }
            const fridge = baseItems.find(f => f.type === "fridge" && f.x === px && f.y === py);
            if (fridge) { holding = { emoji: fridge.emoji, id: genId(), checked: false, cooked: false }; renderGrid(); return; }
        } else {
            const serve = baseItems.find(f => f.type === "serve" && f.x === px && f.y === py);
            if (holding.isBurger && serve) {
                let matched = false;
                for (let i = 0; i < activeOrders.length; i++) {
                    const order = activeOrders[i];
                    const orderItems = order.items.split(" + ").map(t => t.trim()).sort();
                    const holdItems = (holding.contents || []).slice().sort();
                    if (multisetsEqual(orderItems, holdItems)) {
                        score += 100;
                        order.div?.remove();
                        activeOrders.splice(i, 1);
                        matched = true;
                        break;
                    }
                }
                if (!matched) score -= 30;
                scoreEl.textContent = `スコア: ${score}`;
                // サーバにもスコアを共有（scores辞書で全体掲示）
                socket.emit("score_update", { sid: mySid || socket.id || "anon", score });
                holding = null; renderGrid(); return;
            }
            spawnedItems.push({ ...holding, x: px, y: py });
            holding = null; renderGrid();
        }
    }

    function handleWAction() {
        if (!playing) return;
        // 包丁
        if (px === 4 && py === 2)
            spawnedItems.forEach(it => { if (it.x === px && it.y === py && ["🥩", "🥬", "🍅"].includes(it.emoji)) it.checked = true; });
        // 火（肉のみ：既にcut済み）
        if (px === 5 && py === 2)
            spawnedItems.forEach(it => { if (it.x === px && it.y === py && it.emoji === "🥩" && it.checked) it.cooked = true; });
        renderGrid();
    }

    document.addEventListener("keydown", e => {
        if (!playing) return;
        if (e.key.startsWith("Arrow")) e.preventDefault();
        if (e.key === "ArrowUp" && py > 0) py--;
        if (e.key === "ArrowDown" && py < 4) py++;
        if (e.key === "ArrowLeft" && px > 0) px--;
        if (e.key === "ArrowRight" && px < 8) px++;
        if (e.key.toLowerCase() === "d") handleDAction();
        if (e.key.toLowerCase() === "w") handleWAction();
        renderGrid();
    });

    // ====== 注文（Flaskはクライアント生成） ======
    function renderOrderVisual(order) {
        const tokens = order.items.split(" + ").map(t => t.trim());
        const block = document.createElement("div");
        block.className = "order-block";
        const itemsRow = document.createElement("div");
        itemsRow.className = "order-items-row";
        tokens.forEach(token => {
            const item = document.createElement("div");
            item.className = "order-item";
            const eSpan = document.createElement("div");
            eSpan.className = "order-emoji"; eSpan.textContent = token;
            item.appendChild(eSpan);
            itemsRow.appendChild(item);
        });
        const timeDiv = document.createElement("div");
        timeDiv.className = "order-time";
        timeDiv.textContent = `残り${order.remain}秒`;
        block.appendChild(itemsRow);
        block.appendChild(timeDiv);
        order.div = block;
        orderEl.appendChild(block);
    }

    function showRandomOrder() {
        if (activeOrders.length >= 7) return;
        const keys = Object.keys(BURGER_RECIPES);
        const name = keys[Math.floor(Math.random() * keys.length)];
        const items = BURGER_RECIPES[name].join(" + ");
        const remain = 40;
        const order = { name, items, remain, div: null };
        activeOrders.push(order);
        renderOrderVisual(order);
    }

    function updateOrders() {
        for (let i = activeOrders.length - 1; i >= 0; i--) {
            const o = activeOrders[i];
            o.remain--;
            if (o.div) {
                const timeDiv = o.div.querySelector(".order-time");
                if (timeDiv) timeDiv.textContent = `残り${Math.max(0, o.remain)}秒`;
            }
            if (o.remain <= 0) {
                score -= 30;
                scoreEl.textContent = `スコア: ${score}`;
                socket.emit("score_update", { sid: mySid || socket.id || "anon", score }); // 期限切れ減点も共有
                o.div?.remove();
                activeOrders.splice(i, 1);
            }
        }
    }

    // ====== サーバ（Flask）からの時刻＆スコア更新 ======
    socket.on("update", payload => {
        if (typeof payload?.time === "number") {
            timer = payload.time;
            timerEl.textContent = timer > 0 ? timer : "終了";
            if (timer <= 0) {
                playing = false;
                clearAllIntervals();
            }
        }
    });

    socket.on("finished", () => {
        playing = false;
        timer = 0;
        timerEl.textContent = "終了";
        clearAllIntervals();
    });

    // scores は { sid: score, ... } の辞書が来る前提（app.py の emit と一致）
    socket.on("score_update", (scoresDict) => {
        try {
            const sid = mySid || socket.id;
            if (sid && scoresDict && typeof scoresDict[sid] === "number") {
                score = scoresDict[sid];
                scoreEl.textContent = `スコア: ${score}`;
            }
        } catch (_) { /* noop */ }
    });

    // ====== ボタン ======
    startBtn.onclick = () => {
        if (playing) return;
        playing = true;

        // 画面初期化
        spawnedItems = []; px = 1; py = 1; holding = null;
        timer = 120; score = 0; activeOrders = [];
        orderEl.innerHTML = ""; scoreEl.textContent = "スコア: 0";
        renderGrid();

        // サーバ側タイマー開始
        socket.emit("start", { seconds: timer });

        // 注文（クライアント側）開始
        clearAllIntervals();
        showRandomOrder();
        orderInterval = setInterval(showRandomOrder, 10000);
        orderUpdateInterval = setInterval(updateOrders, 1000);
    };

    pauseBtn.onclick = () => {
        if (!playing) return;
        pausedTime = timer;
        playing = false;
        socket.emit("stop");
        clearAllIntervals();
    };

    resumeBtn.onclick = () => {
        if (playing || pausedTime == null || pausedTime <= 0) return;
        playing = true;
        timer = pausedTime;
        socket.emit("start", { seconds: pausedTime }); // 再カウント開始

        // 注文タイマー再開（クライアント側）
        clearAllIntervals();
        orderInterval = setInterval(showRandomOrder, 10000);
        orderUpdateInterval = setInterval(updateOrders, 1000);
    };

    // ====== 初期描画 ======
    renderGrid();

    // ページ離脱時にサーバ負荷軽減（任意）
    window.addEventListener("beforeunload", () => {
        try { socket.emit("stop"); } catch (_) { }
        clearAllIntervals();
    });
})();
