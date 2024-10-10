const microphoneSelect = document.getElementById("microphone-select");
const ball = document.getElementById("ball");
const noteDisplay = document.getElementById("note-display");
let audioContext;
let analyserNode;
let dataArray;
let audioStream;
let animationFrameId;

// Tabela de notas
const noteStrings = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
];

// Parâmetros para o algoritmo YIN
const yinThreshold = 0.1; // Limite para aceitação de um resultado

function startAudioStream(deviceId) {
    if (audioStream) {
        audioStream.getTracks().forEach((track) => track.stop());
    }
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }

    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    const constraints = deviceId
        ? { audio: { deviceId: { exact: deviceId } } }
        : { audio: true };

    navigator.mediaDevices
        .getUserMedia(constraints)
        .then((stream) => {
            audioStream = stream;
            const source = audioContext.createMediaStreamSource(stream);

            if (!analyserNode) {
                analyserNode = audioContext.createAnalyser();
                analyserNode.fftSize = 1024; // Reduzido para melhorar a detecção de altas frequências
            }

            source.connect(analyserNode);

            dataArray = new Float32Array(analyserNode.fftSize);
            detectPitch();
        })
        .catch((err) => {
            console.error("Erro ao acessar o stream de áudio:", err);
        });
}

function populateMicrophoneList() {
    navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => {
            const microphones = devices.filter(
                (device) => device.kind === "audioinput"
            );
            microphoneSelect.innerHTML = "";
            microphones.forEach((microphone, index) => {
                const option = document.createElement("option");
                option.value = microphone.deviceId;
                option.text = microphone.label || `Microfone ${index + 1}`;
                microphoneSelect.appendChild(option);
            });
            startAudioStream(microphoneSelect.value);
        })
        .catch((err) => {
            console.error("Erro ao enumerar dispositivos:", err);
        });
}

microphoneSelect.addEventListener("change", () => {
    startAudioStream(microphoneSelect.value);
});

function yinDetector(buffer, sampleRate) {
    const bufferSize = buffer.length;
    const yinBufferLength = Math.floor(bufferSize / 4); // Reduzido para melhorar a detecção de altas frequências
    const yinBuffer = new Float32Array(yinBufferLength);
    let probability = 0;
    let tauEstimate = -1;

    // Passo 1: Calcula a função de diferença
    for (let tau = 0; tau < yinBufferLength; tau++) {
        yinBuffer[tau] = 0;
        for (let i = 0; i < yinBufferLength; i++) {
            const delta = buffer[i] - buffer[i + tau];
            yinBuffer[tau] += delta * delta;
        }
    }

    // Passo 2: Calcula a função cumulativa normalizada
    yinBuffer[0] = 1;
    let runningSum = 0;
    for (let tau = 1; tau < yinBufferLength; tau++) {
        runningSum += yinBuffer[tau];
        yinBuffer[tau] *= tau / runningSum;
    }

    // Passo 3: Encontra o mínimo onde a probabilidade é maior que o limiar
    for (let tau = 2; tau < yinBufferLength; tau++) {
        if (yinBuffer[tau] < yinThreshold) {
            while (
                tau + 1 < yinBufferLength &&
                yinBuffer[tau + 1] < yinBuffer[tau]
            ) {
                tau++;
            }
            tauEstimate = tau;
            probability = 1 - yinBuffer[tau];
            break;
        }
    }

    // Passo 4: Refinar a estimativa de tau
    if (tauEstimate !== -1) {
        const betterTau = parabolicInterpolation(yinBuffer, tauEstimate);
        return sampleRate / betterTau;
    } else {
        return -1;
    }
}

function parabolicInterpolation(yinBuffer, tauEstimate) {
    const x0 = tauEstimate < 1 ? tauEstimate : tauEstimate - 1;
    const x2 =
        tauEstimate + 1 < yinBuffer.length ? tauEstimate + 1 : tauEstimate;

    if (x0 === tauEstimate) {
        if (yinBuffer[tauEstimate] <= yinBuffer[x2]) {
            return tauEstimate;
        } else {
            return x2;
        }
    }

    if (x2 === tauEstimate) {
        if (yinBuffer[tauEstimate] <= yinBuffer[x0]) {
            return tauEstimate;
        } else {
            return x0;
        }
    }

    const s0 = yinBuffer[x0];
    const s1 = yinBuffer[tauEstimate];
    const s2 = yinBuffer[x2];

    // Ajuste parabólico
    const a = (s0 + s2 - 2 * s1) / 2;
    const b = (s2 - s0) / 2;

    if (a === 0) {
        return tauEstimate;
    }

    return tauEstimate - b / (2 * a);
}

function noteFromPitch(frequency) {
    frequency = frequency / 2; // Ajusta a frequência para uma oitava abaixo
    const A4 = 440;
    const semitone = 69;
    const noteNumber = 12 * (Math.log(frequency / A4) / Math.log(2)) + semitone;
    return Math.round(noteNumber);
}

function frequencyToNoteString(note) {
    const octave = Math.floor(note / 12) - 1;
    const noteName = noteStrings[note % 12];
    return noteName + octave;
}

function detectPitch() {
    analyserNode.getFloatTimeDomainData(dataArray);
    let pitch = yinDetector(dataArray, audioContext.sampleRate);

    console.log("Pitch", pitch);

    if (pitch !== -1) {
        const note = noteFromPitch(pitch);
        const noteString = frequencyToNoteString(note);
        noteDisplay.textContent = `Nota: ${noteString}`;

        // Mover a bolinha para uma altura específica baseada na nota
        const minNote = 40; // Aproximadamente E2 (82 Hz)
        const maxNote = 84; // Aproximadamente C6 (1046 Hz)
        const clampedNote = Math.min(Math.max(note, minNote), maxNote);

        const normalizedNote = (clampedNote - minNote) / (maxNote - minNote);
        const windowHeight = window.innerHeight - 50; // 50 é a altura da bola
        const positionY = windowHeight - normalizedNote * windowHeight;

        ball.style.top = `${positionY}px`;
    } else {
        noteDisplay.textContent = `Nota: --`;
    }

    animationFrameId = requestAnimationFrame(detectPitch);
}

// Inicia solicitando permissão de áudio e populando a lista de dispositivos
navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then((stream) => {
        // Permissão concedida
        stream.getTracks().forEach((track) => track.stop());
        populateMicrophoneList();
    })
    .catch((err) => {
        console.error("Erro ao acessar o microfone:", err);
    });
