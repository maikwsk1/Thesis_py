from flask import Flask, render_template, request
from flask_socketio import SocketIO
import threading

app = Flask(__name__)
app.config["SECRET_KEY"] = "secret!"
socketio = SocketIO(app, cors_allowed_origins="*")

# カウントダウン管理
running = False
stop_event = None
current_time = 0

# クライアントごとのスコア
scores = {}  # { sid: score }

@app.route("/")
def home():
    return render_template("index.html")

@app.route("/countdown")
def countdown_page():
    return render_template("countdown.html")

def countdown_task(ev):
    global running, current_time
    while current_time > 0:
        if ev.is_set():
            running = False
            return
        socketio.emit("update", {"time": current_time})
        socketio.sleep(1)
        current_time -= 1
    running = False
    socketio.emit("finished", {"msg": "カウント終了"})

@socketio.on("start")
def handle_start(data):
    global running, stop_event, current_time
    if not running:
        stop_event = threading.Event()
        sec = int(data.get("seconds", current_time or 10))
        if current_time == 0:
            current_time = sec
        running = True
        socketio.start_background_task(countdown_task, stop_event)

@socketio.on("stop")
def handle_stop():
    global running, stop_event
    if running and stop_event:
        stop_event.set()
    running = False
    socketio.emit("update", {"time": current_time})

@socketio.on("finish")
def handle_finish():
    global running, stop_event, current_time
    if running and stop_event:
        stop_event.set()
    running = False
    current_time = 0
    socketio.emit("update", {"time": "--"})
    socketio.emit("go_home")

# フィールド同期
@socketio.on("field_update")
def handle_field_update(data):
    socketio.emit("field_state", data, broadcast=True)

# スコア更新
@socketio.on("score_update")
def handle_score_update(data):
    sid = request.sid
    scores[sid] = data.get("score", 0)
    print(f"[Score] sid={sid} score={scores[sid]}")

if __name__ == "__main__":
    socketio.run(app, debug=True)
