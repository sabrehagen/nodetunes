'use strict';

var _ = require('lodash');
var net = require('net');
var ServerParser = require('httplike');
var tools = require('./helper');
var RtpServer = require('./rtp');
var debug = require('debug')('nodetunes:rtsp');
var error = require('debug')('nodetunes:error');
var util = require('util');

function RtspServer(options, external) {
  debug = require('debug')('nodetunes:rtsp'); // HACK: need to reload debug here (https://github.com/visionmedia/debug/issues/150)

  this.external = external;
  this.options = options;

  this.ports = [];

  this.rtp = new RtpServer(this);
  this.macAddress = options.macAddress;
  this.metadata = {};
  this.outputStream = null;

  this.handling = null;
  this.clientConnected = null;
  this.controlTimeout = options.controlTimeout;

  this.methodMapping = _.extend({},require('./rtspmethods')(this),options.rtspMethods);

  this.startRtp();
}

RtspServer.prototype.connectHandler = function(socket) {

  if (this.handling && !this.clientConnected) {
    // FIXME: Single client WTF?
    socket.end();
    return;
  }

  this.socket = socket;
  this.handling = socket;

  socket.id = Date.now();

  var parser = new ServerParser(socket, {
    protocol: 'RTSP/1.0',
    statusMessages: {
      453: 'NOT ENOUGH BANDWIDTH',
    },
  });

  parser.on('message',(req,res) => {
    req.socket = socket;
    req.ip = socket.remoteAddress;
    const cseq = req.getHeader('CSeq');
    if (cseq) {
      res.set('CSeq',cseq);
    }
    res.set('Server','AirTunes/105.1');

    const func = this.methodMapping[req.method];

    res.options.protocol = req.protocol;
    if (req.getHeader('Connection') == 'close') {
      const old_send = res.send;
      res.send = function() {
        old_send.apply(this,arguments);
        socket.end();
      };
    }
    if (func) {
      func(req, res);
    } else {
      console.error('received unknown method:',req.method);
      res.send(400);
      socket.end();
    }
  });

  socket.on('close',this.disconnectHandler.bind(this,socket));
};

RtspServer.prototype.startRtp = function() {
  if (!this.rtp.isRunning()) {
    this.ports = [];

    function getRandomPort() {
      const min = 5000;
      const max = 9999;
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    this.ports = [getRandomPort(),getRandomPort(),getRandomPort()];
    this.rtp.start();
    debug("startRtp: setting udp ports (audio: %s, control: %s, timing: %s)",
      this.ports[0],this.ports[1],this.ports[2]);
  } else {
    debug("startRtp: RTP server already running, not starting.");
  }
};

RtspServer.prototype.timeoutHandler = function() {
  debug('client timeout detected (no ping in %s seconds)', this.controlTimeout);
  if (this.clientConnected) {
    this.clientConnected.destroy();
  }
};

RtspServer.prototype.disconnectHandler = function(socket) {
  if (socket === this.handling) {
    this.handling = null;
  }

  if (socket === this.clientConnected) {
    debug('client disconnected');

    this.clientConnected = null;
    this.outputStream = null;
    this.rtp.stop();
    this.external.emit('clientDisconnected');
  }

};

module.exports = RtspServer;
