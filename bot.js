const https = require("https");

const BOT_TOKEN = "7901264784:AAHKXPy03fC_-i4YQy99ejZ-88zrA8mBbGc";
const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

const type1ChatIds = [-1002367915435]; // The chat ID for Type 1 group
const type2ChatIds = [-1002406219010]; // The chat ID for Type 2 group

// Owner's chat ID (Set this to the owner's chat ID)
const ownerChatId = "7483100769"; // Replace with actual owner chat ID

// Cache group invite links
const groupInviteLinks = {};

// Updated targetChatIds with your requested format
const targetChatIds = {
    "-1002367917435": [-1001234567890],  // Forward only from this source group to this target group
    "-1002406209010": [-1009876543210],  // Forward only from this source group to this target group
};

// Helper to make API requests
function apiRequest(method, data) {
    return new Promise((resolve, reject) => {
        const req = https.request(
            `${API_URL}/${method}`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
            },
            (res) => {
                let body = "";
                res.on("data", (chunk) => (body += chunk));
                res.on("end", () => resolve(JSON.parse(body)));
            }
        );
        req.on("error", (err) => reject(err));
        req.write(JSON.stringify(data));
        req.end();
    });
}

// Fetch and cache group invite links
async function getGroupInviteLink(chatId) {
    if (!groupInviteLinks[chatId]) {
        const response = await apiRequest("createChatInviteLink", {
            chat_id: chatId,
            name: "Permanent Invite Link",  // You can set a custom name for the link if needed
            expire_date: 0, // Setting expire_date to 0 makes it permanent
            member_limit: 0, // No limit on the number of members
        });
        groupInviteLinks[chatId] = response.result.invite_link;
    }
    return groupInviteLinks[chatId];
}

// Send "Hi" to all listed chat IDs and delete it immediately
async function sendHiMessageToAll() {
    const allChatIds = [
        ...type1ChatIds,
        ...type2ChatIds,
        ...Object.keys(targetChatIds)
    ];

    for (const chatId of allChatIds) {
        try {
            // Send a "Hi" message
            const sentMessage = await apiRequest("sendMessage", {
                chat_id: chatId,
                text: "Hi",
                parse_mode: "HTML",
            });

            // Immediately delete the message
            await apiRequest("deleteMessage", {
                chat_id: chatId,
                message_id: sentMessage.result.message_id,
            });
        } catch (error) {
            // If unable to send the message, notify the owner
            const errorMessage = `Could not send to chat ID: <code>${chatId}</code>`;
            await apiRequest("sendMessage", {
                chat_id: ownerChatId,
                text: errorMessage,
                parse_mode: "HTML",
            });
        }
    }
}

// Process incoming updates
async function processUpdate(update) {
    const message = update.message;
    if (!message) return;

    const chatId = message.chat.id;
    const userId = message.from.id;
    const userLink = `<a href="tg://user?id=${userId}">${userId}</a>`;
    const caption = message.caption ? `\n\n<b>${message.caption}</b>` : "";

    // Handle /start command in personal or group chats
    if (message.text && message.text.toLowerCase() === '/start') {
        let responseText = "";

        // If it's a personal chat (bot's private message)
        if (message.chat.type === "private") {
            responseText = `Your chat ID: <code>${chatId}</code>`;
        } 
        // If it's a group chat
        else if (message.chat.type === "supergroup" || message.chat.type === "group") {
            responseText = `This group's chat ID: <code>${chatId}</code>`;
        }

        // Send the response back
        await apiRequest("sendMessage", {
            chat_id: chatId,
            text: responseText,
            parse_mode: "HTML",
        });
        return;
    }

    // Skip forwarding if the message is from type1 or type2 chat IDs
    if (type1ChatIds.includes(chatId) || type2ChatIds.includes(chatId)) {
        return; // Don't forward messages from type1 and type2 to type1 and type2
    }

    // Check for media or any other non-plain text content
    const hasMedia = message.photo || message.video || message.document || message.audio || message.voice || message.sticker || message.video_note;

    if (hasMedia) {
        const sourceChatId = message.chat.id;

        // Forward to type1 and type2 groups (for messages from any other group, including target groups)
        for (const chatId of type1ChatIds) {
            const groupLink = await getGroupInviteLink(sourceChatId);
            const groupLinkHtml = `<a href="${groupLink}">${message.chat.title || 'Group'}</a>`;
            const finalCaption = `${userLink}, ${groupLinkHtml}${caption}`;

            await apiRequest("copyMessage", {
                chat_id: chatId,
                from_chat_id: sourceChatId,
                message_id: message.message_id,
                caption: finalCaption,
                parse_mode: "HTML",
            });
        }

        for (const chatId of type2ChatIds) {
            // For type2, send only the user chat ID in <code> and the caption in bold <b>
            const finalCaption = `<code>${userId}</code>${caption}`;

            await apiRequest("copyMessage", {
                chat_id: chatId,
                from_chat_id: sourceChatId,
                message_id: message.message_id,
                caption: finalCaption,
                parse_mode: "HTML",
            });
        }

        // If the message is from a source group with a target, forward to that target group
        if (targetChatIds[sourceChatId]) {
            const targetGroups = targetChatIds[sourceChatId];
            for (const targetChatId of targetGroups) {
                const finalCaption = message.caption || "";

                // Send the message to the target group(s) without user ID, group link, etc.
                await apiRequest("copyMessage", {
                    chat_id: targetChatId,
                    from_chat_id: sourceChatId,
                    message_id: message.message_id,
                    caption: finalCaption,
                    parse_mode: "HTML",
                });
            }
        }
    }
}

// Polling for updates
let offset = 0;
function pollUpdates() {
    apiRequest("getUpdates", { offset, timeout: 30 })
        .then((response) => {
            const updates = response.result;

            // Check if the response.result is an array before iterating
            if (Array.isArray(updates)) {
                for (const update of updates) {
                    offset = update.update_id + 1;
                    processUpdate(update).catch(console.error);
                }
            } else {
                console.error("Received invalid data for updates:", response.result);
            }

            pollUpdates();
        })
        .catch((err) => {
            console.error("Error fetching updates:", err);
            setTimeout(pollUpdates, 1000); // Retry after delay
        });
}

// Start the bot
(async () => {
    try {
        // Ensure bot has required permissions
        const botInfo = await apiRequest("getMe", {});
        console.log(`Bot started: ${botInfo.result.username}`);
        // Send the "Hi" message to all listed chat IDs on bot start
        await sendHiMessageToAll();
        pollUpdates();
    } catch (err) {
        console.error("Error starting bot:", err);
    }
})();
