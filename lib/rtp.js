'use strict';

var dgram = require('dgram');
var tools = require('./helper');
var crypto = require('crypto');
var debug = require('debug')('nodetunes:rtp');

function RtpServer(rtspServer) {
  this.rtspServer = rtspServer;
  this.baseServer = false;
  debug = require('debug')('nodetunes:rtp'); // HACK: need to reload debug here (https://github.com/visionmedia/debug/issues/150)
}

RtpServer.prototype.start = function() {
  if (this.baseServer) {
    debug("server already started");
  } else {
    debug("starting rtp servers");

    var socketType = this.rtspServer.ipv6 ? 'udp6' : 'udp4';
    this.baseServer = dgram.createSocket(socketType);
    this.controlServer = dgram.createSocket(socketType);
    this.timingServer = dgram.createSocket(socketType);

    this.baseServer.bind(this.rtspServer.ports[0]);
    this.controlServer.bind(this.rtspServer.ports[1]);
    this.timingServer.bind(this.rtspServer.ports[2]);

    this.timeoutCounter = -1;
    this.last_audio_seq = false;

    this.baseServer.on('message',(msg) => {
      var seq = msg.readUInt16BE(2);
      var rtp_ts = msg.readUInt32BE(4);

      if (this.last_audio_seq && this.last_audio_seq + 1 != seq) {
        debug("packet drop or ooo: last: %s, this: %s",this.last_audio_seq,seq);
      }
      this.last_audio_seq = seq;

      var audio = tools.decryptAudioData(msg, this.rtspServer.audioAesKey, this.rtspServer.audioAesIv);
      this.rtspServer.external.emit('audio',audio,seq,rtp_ts);
    });

    this.controlServer.on('message',(msg) => {
    });

    this.timingServer.on('message',(msg) => {
      debug("timing:",msg);
    });
  }
};

RtpServer.prototype.isRunning = function() {
  return !!this.baseServer;
};

RtpServer.prototype.stop = function() {
  if (this.baseServer) {
    debug("stopping rtp servers");
    try { this.baseServer.close(); } catch (e) {}
    try { this.controlServer.close(); } catch (e) {}
    try { this.timingServer.close(); } catch (e) {}

    this.baseServer = false;
    this.controlServer = false;
    this.timingServer = false;
  }
};

module.exports = RtpServer;
