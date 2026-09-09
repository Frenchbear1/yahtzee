YAHTZEE TABLE — LOCAL EDITION

One computer hosts. Everyone plays on their own phone. No internet or accounts needed during play.

SET UP ONCE
1. Install Node.js 22.13 or newer on a Mac, Windows, or Linux computer (nodejs.org).
2. Unzip this folder somewhere you want to keep your game history.
3. Open a terminal in this folder and run: node start.mjs
   On Windows, you can double-click Start-Windows.cmd instead.
4. Keep that window open and the computer awake. If your firewall asks, allow access on your private home network.
5. Connect the phones and computer to the same Wi-Fi. Open the phone address shown in the terminal.
6. Each person taps their name at the top to set it. One person opens Family table and shares the code. Everyone else joins using that code.

PLAY
Tap a category, then tap a score. Enter the five-dice total for 3/4 of a kind or Chance.
Tap 0 to cross out a category. Tap any saved score to edit it. Undo reverses your last score.
The 35-point upper bonus is automatic. Extra Yahtzees use the + button next to Yahtzee bonus.
The big YAHTZEE button celebrates without changing points.
Everyone's scores refresh every four seconds. Complete all 13 categories for the animated final tally.
Game history groups the same game's players by date and time. Leaderboard wins count only fully finished multiplayer games; ties share a win.

KEEP YOUR HISTORY
Scores are saved in yahtzee-scores.sqlite next to start.mjs. This is separate from the online app.
Stop the server (Ctrl+C) before backing up the folder. Keep the same browser on each phone to retain that player's identity.
A new network address or clearing browser data may give a phone a new identity. Keep a fixed computer address in your router if you want stable bookmarks.
The computer must stay on while playing. After the first download, no internet connection is required.
A guest Wi-Fi network may block phones from reaching the computer. Use the same normal home network.

START AGAIN
Run node start.mjs in this folder. Share the displayed address if it has changed.
No npm install, subscriptions, or cloud database are needed.
