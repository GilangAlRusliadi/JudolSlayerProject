require("dotenv").config();
const fs = require("fs");
const readline = require("readline");
const { google } = require("googleapis");

// OAuth scope dan path token
const SCOPES = ["https://www.googleapis.com/auth/youtube.force-ssl"];
const TOKEN_PATH = "token.json";

// Autentikasi OAuth
async function authorize() {
    const credentials = JSON.parse(fs.readFileSync("credentials.json"));
    const { client_secret, client_id, redirect_uris } = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    if (fs.existsSync(TOKEN_PATH)) {
        oAuth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH)));
        return oAuth2Client;
    }

    return await getNewToken(oAuth2Client);
}

// Ambil token baru dari user (satu kali)
function getNewToken(oAuth2Client) {
    return new Promise((resolve, reject) => {
        const authUrl = oAuth2Client.generateAuthUrl({
            access_type: "offline",
            scope: SCOPES,
        });

        console.log("Authorize this app by visiting this URL:\n", authUrl);
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

        rl.question("Enter the code from that page here: ", (code) => {
            rl.close();
            oAuth2Client.getToken(code, (err, token) => {
                if (err) {
                    console.error("Error retrieving access token", err);
                    reject(err);
                    return;
                }
                oAuth2Client.setCredentials(token);
                fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
                console.log("Token stored to", TOKEN_PATH);
                resolve(oAuth2Client);
            });
        });
    });
}

// Ambil semua video ID dari channel
async function getAllVideoIdsFromChannel(auth, channelId) {
    const youtube = google.youtube({ version: "v3", auth });
    let videoIds = [];
    let nextPageToken = "";

    do {
        const res = await youtube.search.list({
            part: "id",
            channelId,
            maxResults: 50,
            pageToken: nextPageToken,
            order: "date",
            type: "video",
        });

        res.data.items.forEach(item => {
            if (item.id && item.id.videoId) {
                videoIds.push(item.id.videoId);
            }
        });

        nextPageToken = res.data.nextPageToken;
    } while (nextPageToken);

    return videoIds;
}

// Ambil komentar dari video
async function fetchComments(auth, videoId) {
    const youtube = google.youtube({ version: "v3", auth });
    const spamComments = [];

    try {
        const response = await youtube.commentThreads.list({
            part: "snippet",
            videoId: videoId,
            maxResults: 100,
        });

        response.data.items.forEach((item) => {
            const comment = item.snippet.topLevelComment.snippet;
            const commentText = comment.textDisplay;
            const commentId = item.id;

            console.log(`📝 Checking comment: "${commentText}"`);

            if (getJudolComment(commentText)) {
                console.log(`🚨 Spam detected: "${commentText}"`);
                spamComments.push(commentId);
            }
        });

        return spamComments;
    } catch (error) {
        console.error("❌ Error fetching comments:", error.message);
        return [];
    }
}

// Deteksi spam sederhana (karakter aneh/unicode abuse)
function getJudolComment(text) {
    const normalizedText = text.normalize("NFKD");
    return text !== normalizedText;
}

// Hapus komentar
async function deleteComments(auth, commentIds) {
    const youtube = google.youtube({ version: "v3", auth });

    for (const commentId of commentIds) {
        try {
            await youtube.comments.delete({ id: commentId });
            console.log(`🗑️ Deleted comment: ${commentId}`);
        } catch (error) {
            console.error(`❌ Failed to delete comment ${commentId}:`, error.message);
        }
    }
}

// MAIN
(async () => {
    try {
        const auth = await authorize();
        const channelId = process.env.YOUTUBE_CHANNEL_ID;

        if (!channelId) {
            console.error("❌ Channel ID not found in .env");
            return;
        }

        const videoIds = await getAllVideoIdsFromChannel(auth, channelId);
        console.log(`📺 Found ${videoIds.length} videos.`);

        for (const videoId of videoIds) {
            console.log(`\n🔍 Processing video ID: ${videoId}`);
            const spamComments = await fetchComments(auth, videoId);

            if (spamComments.length > 0) {
                console.log(`🧹 Deleting ${spamComments.length} spam comments...`);
                await deleteComments(auth, spamComments);
            } else {
                console.log("✅ No spam comments found.");
            }
        }
    } catch (error) {
        console.error("❌ Error running script:", error.message);
    }
})();

// npm install googleapis dotenv
// node index.js
