'use strict';

var AirTunesServer = require('../index');
var Speaker = require('speaker');

var speaker = new Speaker({
  channels: 2,
  bitDepth: 16,
  sampleRate: 44100,
});
var server = new AirTunesServer({ serverName: 'NodeTunes Example' });

server.on('clientConnected',(stream) => {
  stream.pipe(speaker);
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

server.start();
