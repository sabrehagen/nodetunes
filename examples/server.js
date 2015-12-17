'use strict';

const AirTunesServer = require('../index');
const Speaker = require('speaker');
const AlacDecoderStream = require('alac2pcm');

const speaker = new Speaker({
  channels: 2,
  bitDepth: 16,
  sampleRate: 44100,
});
const server = new AirTunesServer({ serverName: 'NodeTunes Example' });

let g_codec = '96 L16/44100/2';

let g_decoder = null;

server.on('clientConnected',(args) => {
  console.log("audioCodec:",args.audioCodec);
  g_codec = args.audioCodec;

  if (g_codec == '96 AppleLossless') {
    const audioOptions = args.audioOptions;
    const decoderOptions = {
      frameLength: parseInt(audioOptions[1], 10),
      compatibleVersion: parseInt(audioOptions[2], 10),
      bitDepth: parseInt(audioOptions[3], 10),
      pb: parseInt(audioOptions[4], 10),
      mb: parseInt(audioOptions[5], 10),
      kb: parseInt(audioOptions[6], 10),
      channels: parseInt(audioOptions[7], 10),
      maxRun: parseInt(audioOptions[8], 10),
      maxFrameBytes: parseInt(audioOptions[9], 10),
      avgBitRate: parseInt(audioOptions[10], 10),
      sampleRate: parseInt(audioOptions[11], 10)
    };

    g_decoder = new AlacDecoderStream(decoderOptions);
  }
});

server.on('audio',(audio,sequence_num,rtp_ts) => {
  if (g_codec == '96 L16/44100/2') {
    for (let i = 0 ; i < audio.length ; i+=2) {
      const temp = audio[i];
      audio[i] = audio[i + 1];
      audio[i + 1] = temp;
    }
    speaker.write(audio);
  } else if (g_codec == '96 AppleLossless') {
    g_decoder.write(audio);
    let buf = g_decoder.read();
    while (buf != null) {
      speaker.write(buf);
      buf = g_decoder.read();
    }
  } else {
    console.log("unsupported codec:",g_codec);
  }
});

server.on('volumeChange',(volume) => {
  console.log("volumeChange:",volume);
});

server.on('progressChange',(progress) => {
  console.log("progressChange:",progress)
});

server.on('flush',() => {
  console.log("flush");
});

server.on('teardown',() => {
  console.log("teardown");
});

server.on('metadataChange',(metadata) => {
  console.log("metadataChange:",metadata);
});

server.on('error',(args) => {
  console.error("error:",args);
});

server.start();
