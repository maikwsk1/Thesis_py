(function () {
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

    const BURGER_RECIPES = {
        "ハンバーガー": ["🫓", "🥩:cooked", "🥬:cut"],
        "ベジバーガー": ["🫓", "🥬:cut", "🍅:cut"],
        "ミートサンド": ["🫓", "🥩:cooked"]
    };

    /* --------- ゲーム状態 --------- */
    let spawnedItems = [], px = 1, py = 1, holding = null;
    let timer = 120, playing = false, countdownInterval = null, orderInterval = null, orderUpdateInterval = null;
    let pausedTime = null;
    let activeOrders = []; // { name, items (string), remain, div }
    let score = 0;

    /* --------- DOM参照 --------- */
    const grid = document.getElementById("grid"),
        timerEl = document.getElementById("timer"),
        orderEl = document.getElementById("orderContainer"),
        scoreEl = document.getElementById("score"),
        startBtn = document.getElementById("startBtn"),
        pauseBtn = document.getElementById("pauseBtn"),
        resumeBtn = document.getElementById("resumeBtn");

    function genId() { return 's-' + Math.random().toString(36).slice(2, 9); }
    function findCell(x, y) { return [...grid.children].find(c => +c.dataset.x === x && +c.dataset.y === y); }
    function isProcessed(it) { return (it.checked || it.cooked) && ["🥩", "🥬", "🍅"].includes(it.emoji); }

    /* --------- グリッド描画 --------- */
    function combineToBurger(x, y) {
        const plate = baseItems.find(b => b.x === x && b.y === y && b.emoji === "🍽️");
        if (!plate) return;
        const cellItems = spawnedItems.filter(it => it.x === x && it.y === y && !it.isBurger);
        const bread = cellItems.filter(it => it.emoji === "🫓").length;
        const processed = cellItems.filter(isProcessed);
        if (bread > 0 && processed.length > 0) {
            let burger = spawnedItems.find(it => it.x === x && it.y === y && it.isBurger);
            if (!burger) {
                burger = { x, y, emoji: "🍔", id: genId(), isBurger: true, contents: [] };
                spawnedItems.push(burger);
            }
            processed.forEach(it => {
                if (!burger.contents.includes(it.emoji)) burger.contents.push(it.emoji);
                spawnedItems = spawnedItems.filter(s => s.id !== it.id);
            });
            spawnedItems = spawnedItems.filter(s => !(s.x === x && s.y === y && s.emoji === "🫓"));
        }
    }

    function renderGrid() {
        grid.innerHTML = "";
        for (let y = 0; y < 5; y++) for (let x = 0; x < 9; x++) {
            const cell = document.createElement("div");
            cell.className = "cell"; cell.dataset.x = x; cell.dataset.y = y; grid.appendChild(cell);
        }
        baseItems.forEach(it => {
            const cell = findCell(it.x, it.y);
            if (cell) {
                const e = document.createElement("div"); e.className = "emoji"; e.textContent = it.emoji;
                if (it.name) e.title = it.name;
                cell.appendChild(e);
            }
        });
        spawnedItems.forEach(it => { if (!it.isBurger) combineToBurger(it.x, it.y); });
        spawnedItems.forEach(it => {
            const cell = findCell(it.x, it.y);
            if (cell) {
                const e = document.createElement("div"); e.className = "emoji"; e.textContent = it.emoji;
                if (it.checked) e.classList.add("checked");
                if (it.cooked && it.emoji === "🥩") e.classList.add("cooked");
                cell.appendChild(e);
                if (it.isBurger && it.contents && it.contents.length > 0) {
                    const tip = document.createElement("div"); tip.className = "burger-tooltip"; tip.textContent = it.contents.join(",");
                    cell.appendChild(tip);
                }
            }
        });
        const playerEl = document.createElement("div"); playerEl.className = "player";
        const cell = findCell(px, py); if (cell) cell.appendChild(playerEl);
        if (holding && cell) {
            const held = document.createElement("div"); held.className = "emoji"; held.textContent = holding.emoji;
            if (holding.checked) held.classList.add("checked");
            if (holding.cooked && holding.emoji === "🥩") held.classList.add("cooked");
            held.style.zIndex = 60; cell.appendChild(held);
            if (holding.isBurger && holding.contents && holding.contents.length > 0) {
                const tip = document.createElement("div"); tip.className = "burger-tooltip"; tip.textContent = holding.contents.join(",");
                cell.appendChild(tip);
            }
        }
    }

    /* --------- 判定補助: 多重集合比較（順序に依存しない） --------- */
    function multisetsEqual(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b)) return false;
        if (a.length !== b.length) return false;
        const freq = {};
        for (const x of a) freq[x] = (freq[x] || 0) + 1;
        for (const x of b) {
            if (!freq[x]) return false;
            freq[x]--;
        }
        return true;
    }

    /* --------- D アクション（拾う / 置く / 提供） --------- */
    function handleDAction() {
        if (!playing) return;
        // console.log("handleDAction 呼ばれた: px=", px, "py=", py, "holding=", holding);

        if (!holding) {
            const idx = spawnedItems.findIndex(it => it.x === px && it.y === py);
            if (idx >= 0) {
                holding = spawnedItems.splice(idx, 1)[0];
                renderGrid();
                return;
            }
            const fridgeHere = baseItems.find(f => f.type === "fridge" && f.x === px && f.y === py);
            if (fridgeHere) {
                holding = { emoji: fridgeHere.emoji, id: genId(), checked: false, cooked: false };
                renderGrid();
                return;
            }
        } else {
            const serveHere = baseItems.find(f => f.type === "serve" && f.x === px && f.y === py);
            if (holding.isBurger && serveHere) {
                // 提供処理（元の order.items が文字列のまま使えるように維持）
                let matched = false;
                for (let i = 0; i < activeOrders.length; i++) {
                    const order = activeOrders[i];
                    const orderContents = order.items
                        .split(" + ")
                        .map(it => it.replace(/:cooked|:cut/g, "").trim())
                        .filter(it => it !== "🫓")
                        .sort();
                    const holdingContents = (holding.contents || []).slice().sort();

                    // デバッグ（ブラウザコンソールに出せます）
                    // console.log("比較: orderContents=", orderContents, "holdingContents=", holdingContents);

                    if (multisetsEqual(orderContents, holdingContents)) {
                        score += 100;
                        scoreEl.textContent = `スコア: ${score}`;
                        order.div.remove();
                        activeOrders.splice(i, 1);
                        matched = true;
                        break;
                    }
                }

                if (!matched) {
                    score -= 30;
                    scoreEl.textContent = `スコア: ${score}`;
                }

                holding = null;
                renderGrid();
                return;
            }

            // 通常の置く処理
            spawnedItems.push({ ...holding, x: px, y: py });
            holding = null;
            renderGrid();
            return;
        }
    }

    /* --------- W アクション（包丁/火の適用） --------- */
    function handleWAction() {
        if (!playing) return;
        if (px === 4 && py === 2) { // 包丁
            spawnedItems.forEach(it => { if (it.x === px && it.y === py && ["🥩", "🥬", "🍅"].includes(it.emoji)) it.checked = true; });
            if (holding && ["🥩", "🥬", "🍅"].includes(holding.emoji)) holding.checked = true;
        }
        if (px === 5 && py === 2) { // 火
            spawnedItems.forEach(it => { if (it.x === px && it.y === py && it.emoji === "🥩" && it.checked) { it.cooked = true; it.checked = false; } });
            if (holding && holding.emoji === "🥩" && holding.checked) { holding.cooked = true; holding.checked = false; }
        }
        renderGrid();
    }

    /* --------- キー操作 --------- */
    document.addEventListener("keydown", e => {
        if (!playing) return;
        if (e.key.startsWith("Arrow")) e.preventDefault();
        if (e.key === "ArrowUp" && py > 0) py--;
        if (e.key === "ArrowDown" && py < 4) py++;
        if (e.key === "ArrowLeft" && px > 0) px--;
        if (e.key === "ArrowRight" && px < 8) px++;
        if (e.key === "d" || e.key === "D") handleDAction();
        if (e.key === "w" || e.key === "W") handleWAction();
        renderGrid();
    });

    /* --------- 注文表示（見た目） ---------
       注文データ self.items は「🫓 + 🥩:cooked + 🥬:cut」のような文字列で保持し、
       見た目だけパースして「材料横並び、ツールはそれぞれ下」にして表示します。
    */
    function renderOrderVisual(order) {
        // order.items は "🫓 + 🥩:cooked + 🥬:cut" のような文字列
        const tokens = order.items.split(" + ").map(t => t.trim());
        const block = document.createElement("div");
        block.className = "order-block";

        const itemsRow = document.createElement("div");
        itemsRow.className = "order-items-row";

        tokens.forEach(token => {
            const [emoji, tag] = token.split(":");
            const item = document.createElement("div");
            item.className = "order-item";

            const eSpan = document.createElement("div");
            eSpan.className = "order-emoji";
            eSpan.textContent = emoji.trim();
            item.appendChild(eSpan);

            // ツール判定（表示のみ）
            let toolText = "";
            const em = emoji.trim();
            if (em === "🥩" && token.includes(":cooked")) toolText = "🔪🔥";
            else if ((em === "🥬" || em === "🍅") && token.includes(":cut")) toolText = "🔪";
            if (toolText) {
                const tSpan = document.createElement("div");
                tSpan.className = "order-tool";
                tSpan.textContent = toolText;
                item.appendChild(tSpan);
            } else {
                // ツール無ければ空のスペースで揃える（見た目安定）
                const tSpan = document.createElement("div");
                tSpan.className = "order-tool";
                tSpan.textContent = "";
                item.appendChild(tSpan);
            }

            itemsRow.appendChild(item);
        });

        const timeDiv = document.createElement("div");
        timeDiv.className = "order-time";
        timeDiv.textContent = `残り${order.remain}秒`;

        block.appendChild(itemsRow);
        block.appendChild(timeDiv);

        // keep reference
        order.div = block;
        orderEl.appendChild(block);
    }

    /* --------- 注文の生成（元の仕様に合わせる） --------- */
    function showRandomOrder() {
        if (!playing) return;
        if (activeOrders.length >= 7) return;
        const keys = Object.keys(BURGER_RECIPES);
        const name = keys[Math.floor(Math.random() * keys.length)];
        const items = BURGER_RECIPES[name].join(" + ");
        const remain = 40;
        const order = { name, items, remain, div: null };
        renderOrderVisual(order);
        activeOrders.push(order);
    }

    /* --------- 注文更新（残り時間） --------- */
    function updateOrders() {
        if (!playing) return;
        for (let i = activeOrders.length - 1; i >= 0; i--) {
            const order = activeOrders[i];
            order.remain--;
            if (order.remain > 0) {
                if (order.div) order.div.querySelector(".order-time").textContent = `残り${order.remain}秒`;
            } else {
                score -= 30;
                scoreEl.textContent = `スコア: ${score}`;
                if (order.div) order.div.remove();
                activeOrders.splice(i, 1);
            }
        }
    }

    /* --------- カウントダウン開始 / 停止 --------- */
    function startCountdown(reset = true) {
        if (reset) {
            timer = 120; score = 0; scoreEl.textContent = `スコア: ${score}`;
            // reset orders visually and logically
            activeOrders.forEach(o => { if (o.div) o.div.remove(); });
            activeOrders = [];
        }
        playing = true;
        timerEl.textContent = timer;
        clearInterval(countdownInterval); clearInterval(orderInterval); clearInterval(orderUpdateInterval);

        countdownInterval = setInterval(() => {
            timer--;
            timerEl.textContent = timer;
            if (timer <= 0) {
                clearInterval(countdownInterval); clearInterval(orderInterval); clearInterval(orderUpdateInterval);
                playing = false;
                timerEl.textContent = "終了";
                startBtn.style.display = "inline";
            }
        }, 1000);

        // 元の仕様どおり、リセット時は1つだけ生成（過去の動作に合わせる）
        if (reset) showRandomOrder();
        orderInterval = setInterval(showRandomOrder, 10000);
        orderUpdateInterval = setInterval(updateOrders, 1000);
    }

    /* --------- ボタンイベント --------- */
    startBtn.onclick = () => { startCountdown(true); startBtn.style.display = "none"; renderGrid(); };
    pauseBtn.onclick = () => { clearInterval(countdownInterval); clearInterval(orderInterval); clearInterval(orderUpdateInterval); playing = false; pausedTime = timer; };
    resumeBtn.onclick = () => { if (pausedTime && !playing) { timer = pausedTime; startCountdown(false); pausedTime = null; } };

    /* 初期描画 */
    renderGrid();

})();