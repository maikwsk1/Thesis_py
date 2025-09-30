from flask import Flask, render_template
from flask_socketio import SocketIO, emit

app = Flask(__name__)
socketio = SocketIO(app, async_mode="eventlet")

current_time = 0
running = False
scores = {}

# ===== 定数 =====
# （Flask版には特に無し。Expressでは BURGER_RECIPES がここに相当）

# ===== ページルーティング =====
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/hamburger")
def hamburger_page():
    return render_template("hamburger.html")

# ===== ゲーム制御 =====
@socketio.on("start")
def handle_start(data):
    global running
    if not running:
        seconds = data.get("seconds", 120)
        socketio.start_background_task(countdown_task, seconds)
        emit("started", {"seconds": seconds})

@socketio.on("stop")
def handle_stop():
    global running
    running = False
    emit("stopped", {"msg": "カウント停止"})

@socketio.on("finish")
def handle_finish():
    global running, current_time
    running = False
    current_time = 0
    emit("finished", {"msg": "強制終了"})

# ===== 状態取得・更新 =====
@socketio.on("field_update")
def handle_field_update(data):
    socketio.emit("field_update", data, broadcast=True)

@socketio.on("score_update")
def handle_score_update(data):
    sid = data.get("sid", "anon")
    score = data.get("score", 0)
    scores[sid] = score
    socketio.emit("score_update", scores, broadcast=True)

# ===== ユーティリティ =====
def countdown_task(seconds):
    global current_time, running
    running = True
    current_time = seconds
    while running and current_time > 0:
        socketio.emit("update", {"time": current_time})
        socketio.sleep(1)
        current_time -= 1
    running = False
    socketio.emit("finished", {"msg": "カウント終了"})

# ===== 実行 =====
if __name__ == "__main__":
    socketio.run(app, debug=True)
