'use strict';

const AirTunesServer = require('../index');
const Speaker = require('speaker');
const AlacDecoderStream = require('alac2pcm');

const PREBUFFER_LENGTH = 44100*2*2;

let speaker = null;

let g_codec = '96 L16/44100/2';
let g_decoder = null;

let g_preBufferList = null;
let g_preBufferLength = 0;

const server_options = {
  serverName: 'NodeTunes Example',
  rtspMethods: {
    EXAMPLE: function(req,res) {
      console.log("EXAMPLE: got request:",req.headers,req.content);
      res.send();
    }
  },
};
const server = new AirTunesServer(server_options);

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
    console.log("decoderOptions:",decoderOptions);

    g_decoder = new AlacDecoderStream(decoderOptions);
  }
  g_preBufferList = [];
  g_preBufferLength = 0;
  speaker = new Speaker({
    channels: 2,
    bitDepth: 16,
    sampleRate: 44100,
  });
  speaker.on('error',() => {
    console.log("speaker error");
  })
});

server.on('audio',(audio,sequence_num,rtp_ts) => {
  if (speaker) {
    let write = null;
    if (g_preBufferList) {
      write = (buf) => {
        g_preBufferList.push(buf);
        g_preBufferLength += buf.length;
      };
    } else {
      write = (buf) => {
        speaker.write(buf);
      };
    }

    if (g_codec == '96 L16/44100/2') {
      for (let i = 0 ; i < audio.length ; i+=2) {
        const temp = audio[i];
        audio[i] = audio[i + 1];
        audio[i + 1] = temp;
      }
      write(audio);
    } else if (g_codec == '96 AppleLossless') {
      g_decoder.write(audio);
      let buf = g_decoder.read();
      while (buf != null) {
        write(buf);
        buf = g_decoder.read();
      }
    } else {
      console.log("unsupported codec:",g_codec);
    }

    if (g_preBufferList && g_preBufferLength > PREBUFFER_LENGTH) {
      console.log("prebuffer done, writing to speaker.");
      g_preBufferList.forEach((buf) => {
        speaker.write(buf);
      });
      g_preBufferList = null;
    }
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
  if (speaker) {
    speaker.end();
    speaker.close();
    speaker = null;
  }
});

server.on('teardown',() => {
  console.log("teardown");
  if (speaker) {
    speaker.end();
    speaker.close();
    speaker = null;
  }
});

server.on('metadataChange',(metadata) => {
  console.log("metadataChange:",metadata);
});

server.on('error',(args) => {
  console.error("error:",args);
});

server.start();
