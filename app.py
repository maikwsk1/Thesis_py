"""
Flask-SocketIOを用いたリアルタイムバーガーゲームアプリ。
クライアントとの非同期通信により、ゲームのタイマーやスコアを管理する。
"""

import threading
from flask import Flask, render_template
from flask_socketio import SocketIO, emit

# ===== モジュール設定 =====
app = Flask(__name__)
socketio = SocketIO(app, async_mode="eventlet")


# ===== 状態管理クラス =====
class GameState:
    """ゲーム全体の状態を一元管理するクラス。"""

    def __init__(self):
        self.lock = threading.Lock()
        self.current_time = 0
        self.running = False
        self.scores = {}

    def start(self, seconds: int):
        """ゲームを開始してカウントダウンを初期化。"""
        with self.lock:
            self.running = True
            self.current_time = seconds
            self.scores = {}

    def stop(self):
        """カウントダウンを停止。"""
        with self.lock:
            self.running = False

    def finish(self):
        """ゲームを強制終了。"""
        with self.lock:
            self.running = False
            self.current_time = 0

    def tick(self):
        """1秒カウントダウンを進める。"""
        with self.lock:
            if self.running and self.current_time > 0:
                self.current_time -= 1
            return self.current_time

    def set_score(self, sid, score):
        """プレイヤーのスコアを更新。"""
        with self.lock:
            self.scores[sid] = score


# ===== グローバルな状態インスタンス =====
state = GameState()


# ===== ページルーティング =====
@app.route("/")
def index():
    """トップページを表示する。"""
    return render_template("index.html")


@app.route("/hamburger")
def hamburger_page():
    """ハンバーガーゲーム画面を表示する。"""
    return render_template("hamburger.html")


# ===== ゲーム制御 =====
@socketio.on("start")
def handle_start(data):
    """ゲームを開始し、カウントダウンタスクを起動する。"""
    if not state.running:
        seconds = data.get("seconds", 120)
        state.start(seconds)
        # 未使用引数警告を防ぐため _seconds に変更
        socketio.start_background_task(countdown_task, _seconds=seconds)
        emit("started", {"seconds": seconds})


@socketio.on("stop")
def handle_stop():
    """カウントダウンを停止する。"""
    state.stop()
    emit("stopped", {"msg": "カウント停止"})


@socketio.on("finish")
def handle_finish():
    """ゲームを強制終了する。"""
    state.finish()
    emit("finished", {"msg": "強制終了"})


# ===== 状態取得・更新 =====
@socketio.on("field_update")
def handle_field_update(data):
    """クライアントから送信されたフィールド情報をブロードキャストする。"""
    socketio.emit("field_update", data)


@socketio.on("score_update")
def handle_score_update(data):
    """各クライアントのスコアを更新し、全クライアントに共有する。"""
    sid = data.get("sid", "anon")
    score = data.get("score", 0)
    state.set_score(sid, score)
    socketio.emit("score_update", state.scores)


# ===== カウントダウンタスク =====
def countdown_task(_seconds):  # 未使用引数→_secondsで明示
    """バックグラウンドでカウントダウンを実行し、毎秒更新を送信する。"""
    while state.running and state.current_time > 0:
        socketio.emit("update", {"time": state.current_time})
        socketio.sleep(1)
        state.tick()
    state.stop()
    socketio.emit("finished", {"msg": "カウント終了"})


# ===== アプリ実行 =====
if __name__ == "__main__":
    # Flask開発サーバは単一スレッドで動作するため、本番ではWSGIサーバを使用すること。
    socketio.run(app, debug=True)
