/// <reference path="../../src/types/sdpi-components.d.ts" />

const { streamDeckClient } = SDPIComponents;

/**
 * Refresh the visible status field from the latest persisted action settings.
 * The PI does not always repaint disabled bound fields while it remains open.
 * @param {number[]} [delays]
 */
async function refreshStatusField(delays = [0, 250, 1000]) {
    for (const delay of delays) {
        if (delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
        }

        const settings = await streamDeckClient.getSettings();
        const statusField = document.getElementById('statusMsg');
        if (statusField) {
            statusField.value = settings.statusMsg || "";
        }
    }
}

/**
 * Inform the plugin that the user has selected a receiver. (Or unset the receiver)
 * @param {HTMLSelectElement} receiverSelect - The receiver select element.
 */
async function handleUserChoseReceiver(receiverSelect) {
    receiverSelect.disabled = true;
    const manualIpField = document.querySelector('sdpi-textfield[setting="manualIp"]');
    const connectButton = document.getElementById('manualIpConnectButton');
    if (connectButton) connectButton.disabled = true;
    await streamDeckClient.send('sendToPlugin', {
        event: 'userConfiguredReceiver',
        settings: {
            uuid: receiverSelect.value,
            manualIp: manualIpField?.value?.trim() || ""
        }
    });
    receiverSelect.disabled = false;
    if (connectButton) connectButton.disabled = false;
    await refreshStatusField();
}

/**
 * Inform the plugin that the user has configured a manual receiver IP.
 * @param {HTMLInputElement} manualIpField - The manual IP field element.
 */
async function handleManualIpChanged(manualIpField) {
    manualIpField.disabled = true;
    const receiverSelect = document.querySelector('sdpi-select[setting="uuid"]');
    const connectButton = document.getElementById('manualIpConnectButton');
    if (connectButton) connectButton.disabled = true;

    const statusField = document.getElementById('statusMsg');
    if (statusField) {
        statusField.value = manualIpField.value.trim() ? "Connecting..." : "";
    }

    await streamDeckClient.send('sendToPlugin', {
        event: 'userConfiguredReceiver',
        settings: {
            uuid: receiverSelect?.value || "",
            manualIp: manualIpField.value.trim()
        }
    });
    manualIpField.disabled = false;
    if (connectButton) connectButton.disabled = false;
    await refreshStatusField();
}

/**
 * Update the volume level item based on the selected volume action.
 * @param {HTMLSelectElement} volumeActionSelect - The volume action select element.
 */
function handleVolumeUIChange(volumeActionSelect) {
    /** @type {HTMLTextAreaElement | null} SDPI TextField Element */
    if (!volumeActionSelect) return;

    // Update sub-control(s) ui visibility
    setTimeout(() => {
        const volumeLevelItem = document.getElementById('volumeLevelItem');
        volumeLevelItem?.classList.toggle('hidden', volumeActionSelect.value !== "set");
    }, 1);
}

/**
 * Update the layout for the action based on the action ID.
 */
async function updateLayoutForAction() {
    const connectionInfo = await streamDeckClient.getConnectionInfo();
    const controller = connectionInfo.actionInfo.payload.controller;
    const actionId = connectionInfo.actionInfo.action.split(".").slice(-1)[0];

    // Reveal the appropriate action section based on the action ID.
    switch (actionId) {
        case "power":
            document.querySelector('.action-section.power')?.classList.remove('hidden');
            break;
        case "volume":
            if (controller === "Keypad") {
                document.querySelector('.action-section.volume')?.classList.remove('hidden');
                /** @type {HTMLSelectElement | null} */
                const volumeActionSelect = document.querySelector('sdpi-select[setting="volumeAction"]');
                if (volumeActionSelect) {
                    handleVolumeUIChange(volumeActionSelect);
                }
            }
            if (controller === "Encoder" || controller === "Knob") {
                document.querySelector('.action-section.stepsize')?.classList.remove('hidden');
            }
            break;
        case "sublevel":
            if (controller === "Encoder" || controller === "Knob") {
                document.querySelector('.action-section.stepsize')?.classList.remove('hidden');
            }
            break;
        case "source":
            if (controller === "Keypad") {
                document.querySelector('.action-section.source')?.classList.remove('hidden');
            }
            break;
        case "dynvol":
        case "dyneq":
            document.querySelector('.separator')?.classList.add('hidden');
            document.querySelector('.zone-item')?.classList.add('hidden');
            break;
    }
}

// Perform the necessary setup once the DOM is loaded.
document.addEventListener('DOMContentLoaded', () => {
    updateLayoutForAction();
    refreshStatusField([0]);
});
