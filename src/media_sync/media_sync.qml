// Copyright (c) 2026, Harry Huang
import QtQuick
import QtQuick.Layouts
import MuseScore 3.0
import MuseScore.Playback 1.0
import Muse.UiComponents

MuseScore {
    title: "MuseKit: Media Sync"
    description: "MediaSync can synchronize MuseScore playback with a browser-based media player via WebSocket. Some exciting features like media chord estimation are also included. (This plugin is a member of MuseKit.)"
    version: "1.1"

    requiresScore: true
    pluginType: "dialog"
    thumbnailName: "media_sync.png"

    width: 360
    height: 270

    // Playback model of MuseScore
    PlaybackToolBarModel {
        id: playbackModel
    }

    // WebSocket server state
    readonly property int wsPort: 8084
    property int clientSocketId: -1
    property bool wsConnected: false
    property bool wsHandshaken: false

    // Playback state
    property bool isPlaying: false
    property real playbackPosition: 0.0
    property real lastSentPosition: -1.0

    // UI state
    property string debugLog: ""

    function appendLog(msg) {
        debugLog = debugLog + msg + "\n";
        const maxLogLength = 4096;
        if (debugLog.length > maxLogLength) {
            debugLog = debugLog.slice(-maxLogLength);
            let nl = debugLog.indexOf("\n");
            if (nl >= 0)
                debugLog = debugLog.slice(nl + 1);
        }
    }

    // Time convertors
    function qTimeToSeconds(t) {
        if (!t)
            return 0;
        return t.getHours() * 3600 + t.getMinutes() * 60 + t.getSeconds() + t.getMilliseconds() / 1000;
    }

    function secondsToQTime(s) {
        var t = new Date();
        t.setHours(Math.floor(s / 3600));
        t.setMinutes(Math.floor((s % 3600) / 60));
        t.setSeconds(Math.floor(s % 60));
        t.setMilliseconds(Math.round((s % 1) * 1000));
        return t;
    }

    function formatPosition(s) {
        function pad2(value) {
            return value < 10 ? "0" + value : "" + value;
        }
        if (s < 0)
            return "00:00:00.000";
        var h = Math.floor(s / 3600);
        var m = Math.floor((s % 3600) / 60);
        var sec = Math.floor(s % 60);
        var ms = Math.round((s % 1) * 1000);
        return pad2(h) + ":" + pad2(m) + ":" + pad2(sec) + "." + ("00" + ms).slice(-3);
    }

    // WebSocket communication
    function sendToBrowser(msg) {
        if (clientSocketId < 0) {
            appendLog("[!] No browser connected");
            return;
        }
        api.websocketserver.send(clientSocketId, msg);
        appendLog("→ " + msg);
        console.log("MediaSync →: " + msg);
    }

    function onClientConnected(id) {
        console.log("MediaSync: client connected, id=" + id);
        if (clientSocketId < 0) {
            clientSocketId = id;
            api.websocketserver.onMessage(clientSocketId, onMessageReceived);
        }
        wsConnected = true;
    }

    function onMessageReceived(msg) {
        console.log("MediaSync ←: " + msg);
        appendLog("← " + msg);

        // Parse lifecycle messages
        let cmd;
        try {
            cmd = JSON.parse(msg);
        } catch (e) {
            return;
        }

        // Handle different message types
        if (cmd.type === "client_hello") {
            wsHandshaken = true;
            sendToBrowser('{"type":"server_hello"}');
        }
    }

    // Playback monitoring is fully automatic —
    // the timer detects play/pause state and sends WS
    // messages; no manual buttons needed.

    // Initialization
    Component.onCompleted: {
        // Load playback model
        playbackModel.load();

        // Start WS server
        api.websocketserver.listen(wsPort, function (id) {
            onClientConnected(id);
        });
        console.log("MediaSync: WS server on :" + wsPort);
        appendLog("[+] WS server listening on :" + wsPort);

        // Open browser companion
        appendLog("[+] Loading browser companion page...");
        Qt.openUrlExternally(Qt.resolvedUrl("media_sync.html"));
    }

    onRun: {
        playbackMonitor.running = true;
    }

    // Playback monitor timer
    Timer {
        id: playbackMonitor
        interval: 50 // State poll interval in ms
        repeat: true
        running: false

        property real prevPos: 0
        property bool lastUnchanged: false
        property real lastPeriodicSentPos: -1
        property int tickCounter: 0

        onTriggered: {
            var pos = qTimeToSeconds(playbackModel.playTime);
            playbackPosition = pos;
            tickCounter++;

            // Detect play state from position movement
            var delta = Math.abs(pos - prevPos);
            var wasPlaying = isPlaying;

            if (delta > 0.001) {
                if (!lastUnchanged && !isPlaying) {
                    isPlaying = true;
                }
                lastUnchanged = false;
            } else {
                if (lastUnchanged && isPlaying) {
                    isPlaying = false;
                }
                lastUnchanged = true;
            }
            prevPos = pos;

            // Immediate send: play/pause transition
            if (isPlaying !== wasPlaying) {
                if (isPlaying) {
                    sendToBrowser('{"type":"play","position":' + pos.toFixed(3) + '}');
                    lastPeriodicSentPos = pos;
                } else {
                    sendToBrowser('{"type":"pause","position":' + pos.toFixed(3) + '}');
                }
                return;
            }

            // Immediate send: position jumped >100ms since last poll
            if (delta > 0.1) {
                if (isPlaying) {
                    sendToBrowser('{"type":"play","position":' + pos.toFixed(3) + '}');
                    lastPeriodicSentPos = pos;
                } else {
                    sendToBrowser('{"type":"seek","position":' + pos.toFixed(3) + '}');
                }
                return;
            }

            // Periodic send: every 1000ms during playback
            if (isPlaying) {
                let elapsed = Math.abs(pos - lastPeriodicSentPos);
                if (elapsed >= 1.0 || lastPeriodicSentPos < 0) {
                    sendToBrowser('{"type":"play","position":' + pos.toFixed(3) + '}');
                    lastPeriodicSentPos = pos;
                }
            }
        }
    }

    // Cleanup
    Component.onDestruction: {
        playbackMonitor.running = false;
        if (clientSocketId >= 0 && wsConnected) {
            sendToBrowser('{"type":"shutdown"}');
        }
    }

    // UI
    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 14
        spacing: 8

        StyledTextLabel {
            id: positionLabel
            text: "Position: " + formatPosition(playbackPosition)
        }

        RowLayout {
            spacing: 6
            StyledTextLabel {
                text: "Status:"
            }

            Rectangle {
                width: 10
                height: 10
                radius: 5
                color: !wsHandshaken ? "#888" : isPlaying ? "#4caf50" : "#ffc107"
            }

            StyledTextLabel {
                text: !wsHandshaken ? "Waiting for handshake" : isPlaying ? "Playing" : "Paused"
            }
        }

        SeparatorLine {
            Layout.fillWidth: true
        }

        StyledTextLabel {
            text: "WebSocket Log:"
        }

        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            color: "#1e1e1e"
            border.width: 1
            border.color: ui.theme.strokeColor
            radius: 4

            Flickable {
                id: flick
                anchors.fill: parent
                anchors.margins: 6
                contentHeight: logText.implicitHeight
                clip: true

                Text {
                    id: logText
                    width: flick.width
                    text: debugLog || "(no messages)"
                    color: "#aaa"
                    font.family: "Consolas"
                    font.pixelSize: 11
                    wrapMode: Text.Wrap
                }
            }
        }

        FlatButton {
            text: "Close"
            Layout.alignment: Qt.AlignRight
            onClicked: {
                playbackMonitor.running = false;
                if (clientSocketId >= 0 && wsConnected) {
                    sendToBrowser('{"type":"shutdown"}');
                }
                quit();
            }
        }
    }
}
