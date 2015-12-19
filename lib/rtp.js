'use strict';

const dgram = require('dgram');
const tools = require('./helper');
const crypto = require('crypto');
const debug = require('debug')('nodetunes:rtp');

function RtpServer(rtspServer) {
  this.rtspServer = rtspServer;
  this.baseServer = false;
}

RtpServer.prototype.start = function() {
  if (this.baseServer) {
    debug("server already started");
  } else {
    debug("starting rtp servers");

    const socketType = this.rtspServer.ipv6 ? 'udp6' : 'udp4';
    this.baseServer = dgram.createSocket(socketType);
    this.controlServer = dgram.createSocket(socketType);
    this.timingServer = dgram.createSocket(socketType);

    this.baseServer.bind(this.rtspServer.ports[0]);
    this.controlServer.bind(this.rtspServer.ports[1]);
    this.timingServer.bind(this.rtspServer.ports[2]);

    this.timeoutCounter = -1;
    this.last_audio_seq = false;

    this.baseServer.on('message',(message) => {
      const packet_type = message.readUInt8(1) & 0x7F;

      const sequence_num = message.readUInt16BE(2);
      const rtp_ts = message.readUInt32BE(4);

      if (this.last_audio_seq && this.last_audio_seq + 1 != sequence_num) {
        debug("packet drop or ooo: last: %s, this: %s",this.last_audio_seq,sequence_num);
      }
      this.last_audio_seq = sequence_num;

      if (packet_type == 96) {
        const input = message.slice(12);
        const audio = tools.decryptAudioData(input,this.rtspServer.audioAesKey,this.rtspServer.audioAesIv);
        const data = {
          message,
          audio,
          sequence_num,
          rtp_ts,
        };
        this.rtspServer.external.emit('audio',data);
      } else {
        console.error("Unknown packet_type:",packet_type);
      }
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
