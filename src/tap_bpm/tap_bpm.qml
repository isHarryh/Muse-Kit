// Copyright (c) 2026, Harry Huang
import QtQuick
import QtQuick.Layouts
import MuseScore 3.0
import Muse.UiComponents

MuseScore {
    id: tapBpmPlugin

    title: "MuseKit: Tap BPM"
    description: "Tap BPM estimates tempo from repeated taps. (This plugin is a member of MuseKit.)"
    version: "1.0"

    requiresScore: false
    pluginType: "dialog"
    thumbnailName: "tap_bpm.png"

    width: 360
    height: 450

    // Tap state
    readonly property int maxStoredIntervals: 32766
    readonly property int minIntervalMs: 50
    readonly property int maxIntervalMs: 6000
    property var tapIntervals: []
    property double lastTapMs: 0
    property int tapCount: 0
    property real estimatedBpm: 0

    // Settings state
    readonly property var basedOnOptions: [
        { "text": "Last 2 taps", "taps": 2 },
        { "text": "Last 4 taps", "taps": 4 },
        { "text": "Last 8 taps", "taps": 8 },
        { "text": "Last 16 taps", "taps": 16 },
        { "text": "Last 32 taps", "taps": 32 },
        { "text": "Last 64 taps", "taps": 64 },
        { "text": "All taps", "taps": 0 }
    ]
    readonly property var precisionOptions: [
        { "text": "No decimal", "decimals": 0 },
        { "text": "1 decimal", "decimals": 1 },
        { "text": "2 decimal", "decimals": 2 },
        { "text": "3 decimal", "decimals": 3 }
    ]
    readonly property var algorithmOptions: [
        { "text": "Average", "algorithm": "average" },
        { "text": "Median", "algorithm": "median" }
    ]
    property int basedOnIndex: 3
    property int precisionIndex: 0
    property int algorithmIndex: 0
    property int basedTapCount: 0

    // UI state
    property string statusText: "Click Tap to start"

    function resetTapState() {
        tapIntervals = [];
        lastTapMs = 0;
        tapCount = 0;
        basedTapCount = 0;
        estimatedBpm = 0;
        statusText = "Click Tap to start";
    }

    function restartTapSequence(now) {
        tapIntervals = [];
        lastTapMs = now;
        tapCount = 1;
        basedTapCount = 1;
        estimatedBpm = 0;
        statusText = "Tap again to estimate tempo";
    }

    function selectedIntervals() {
        var intervalCount = tapIntervals.length;
        var tapLimit = basedOnOptions[basedOnIndex].taps;
        if (tapLimit > 0)
            intervalCount = Math.min(intervalCount, tapLimit - 1);

        if (intervalCount <= 0)
            return [];

        return tapIntervals.slice(tapIntervals.length - intervalCount);
    }

    function averageInterval(intervals) {
        var total = 0;
        for (let i = 0; i < intervals.length; i++)
            total += intervals[i];
        return total / intervals.length;
    }

    function medianInterval(intervals) {
        var sorted = intervals.slice(0).sort(function(a, b) { return a - b; });
        var middle = Math.floor(sorted.length / 2);
        if (sorted.length % 2 === 1)
            return sorted[middle];
        return (sorted[middle - 1] + sorted[middle]) / 2;
    }

    function updateBpm() {
        var intervals = selectedIntervals();
        if (intervals.length <= 0) {
            estimatedBpm = 0;
            basedTapCount = tapCount > 0 ? 1 : 0;
            return;
        }

        var interval = algorithmOptions[algorithmIndex].algorithm === "median"
            ? medianInterval(intervals)
            : averageInterval(intervals);

        basedTapCount = intervals.length + 1;
        estimatedBpm = 60000 / interval;
        statusText = basedOnOptions[basedOnIndex].taps === 0
            ? "Based on all taps"
            : "Based on last " + basedTapCount + " taps";
    }

    function formatBpm() {
        if (estimatedBpm <= 0)
            return "--";
        return estimatedBpm.toFixed(precisionOptions[precisionIndex].decimals);
    }

    function registerTap() {
        var now = (new Date()).getTime();

        if (lastTapMs <= 0) {
            restartTapSequence(now);
            return;
        }

        var interval = now - lastTapMs;

        if (interval < minIntervalMs)
            return;

        if (interval > maxIntervalMs) {
            restartTapSequence(now);
            return;
        }

        var intervals = tapBpmPlugin.tapIntervals.slice(0);
        intervals.push(interval);
        while (intervals.length > maxStoredIntervals)
            intervals.shift();

        tapIntervals = intervals;
        lastTapMs = now;
        tapCount++;
        updateBpm();
    }

    Component.onCompleted: {
        resetTapState();
    }

    // UI
    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 14
        spacing: 10

        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 120
            color: "#1e1e1e"
            border.width: 1
            border.color: ui.theme.strokeColor
            radius: 4

            ColumnLayout {
                anchors.centerIn: parent
                spacing: 4

                Text {
                    Layout.alignment: Qt.AlignHCenter
                    text: tapBpmPlugin.formatBpm()
                    color: "#ffffff"
                    font.pixelSize: 44
                    font.bold: true
                }

                Text {
                    Layout.alignment: Qt.AlignHCenter
                    text: "BPM"
                    color: "#aaa"
                    font.pixelSize: 14
                }
            }
        }

        StyledTextLabel {
            Layout.fillWidth: true
            text: tapBpmPlugin.statusText
        }

        StyledTextLabel {
            Layout.fillWidth: true
            text: "Total taps: " + tapBpmPlugin.tapCount
        }

        RowLayout {
            Layout.fillWidth: true
            spacing: 8

            StyledTextLabel {
                text: "Based on:"
                Layout.preferredWidth: 78
            }

            StyledDropdown {
                Layout.fillWidth: true
                model: tapBpmPlugin.basedOnOptions
                currentIndex: tapBpmPlugin.basedOnIndex
                onActivated: function(index, value) {
                    tapBpmPlugin.basedOnIndex = index;
                    tapBpmPlugin.updateBpm();
                }
            }
        }

        RowLayout {
            Layout.fillWidth: true
            spacing: 8

            StyledTextLabel {
                text: "Precision:"
                Layout.preferredWidth: 78
            }

            StyledDropdown {
                Layout.fillWidth: true
                model: tapBpmPlugin.precisionOptions
                currentIndex: tapBpmPlugin.precisionIndex
                onActivated: function(index, value) {
                    tapBpmPlugin.precisionIndex = index;
                }
            }
        }

        RowLayout {
            Layout.fillWidth: true
            spacing: 8

            StyledTextLabel {
                text: "Algorithm:"
                Layout.preferredWidth: 78
            }

            StyledDropdown {
                Layout.fillWidth: true
                model: tapBpmPlugin.algorithmOptions
                currentIndex: tapBpmPlugin.algorithmIndex
                onActivated: function(index, value) {
                    tapBpmPlugin.algorithmIndex = index;
                    tapBpmPlugin.updateBpm();
                }
            }
        }

        FlatButton {
            text: "Tap"
            Layout.fillWidth: true
            accentButton: true
            onClicked: {
                tapBpmPlugin.registerTap();
            }
        }

        SeparatorLine {
            Layout.fillWidth: true
        }

        RowLayout {
            Layout.fillWidth: true
            spacing: 8

            FlatButton {
                text: "Reset"
                Layout.fillWidth: true
                onClicked: {
                    tapBpmPlugin.resetTapState();
                }
            }

            FlatButton {
                text: "Close"
                Layout.fillWidth: true
                onClicked: {
                    quit();
                }
            }
        }
    }
}
