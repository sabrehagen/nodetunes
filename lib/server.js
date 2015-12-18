'use strict';

var _ = require('lodash');
var mdns = require('mdns');
var net = require('net');
var portastic = require('portastic');
var randomMac = require('random-mac');
var RtspServer = require('./rtsp');
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var debug = require('debug')('nodetunes:server');

function NodeTunes(options) {
  this.options = _.extend({},{
    serverName: 'NodeTunes',
    macAddress: randomMac().toUpperCase().replace(/:/g, ''),
    recordDumps: false,
    recordMetrics: false,
    controlTimeout: 5,
    verbose: false,
    advertise: true,
  },options);

  if (options.verbose) {
    require('debug').enable('nodetunes:*');
    debug = require('debug')('nodetunes:server');  // HACK: need to reload debug here (https://github.com/visionmedia/debug/issues/150)
  }

  this.txtSetup = {
    txtvers: '1',     // txt record version?
    ch: '2',          // # channels
    cn: '0,1',          // codec; 0=pcm, 1=alac, 2=aac, 3=aac elc; fwiw Sonos supports aac; pcm required for iPad+Spotify; OS X works with pcm
    et: '0,1',        // encryption; 0=none, 1=rsa, 3=fairplay, 4=mfisap, 5=fairplay2.5; need rsa for os x
    md: '0,1,2',          // metadata; 0=text, 1=artwork, 2=progress
    pw: (options.password ? 'true' : 'false'),    // password enabled
    sr: '44100',      // sampling rate (e.g. 44.1KHz)
    ss: '16',         // sample size (e.g. 16 bit?)
    tp: 'TCP,UDP',    // transport protocol
    vs: '105.1',     // server version?
    am: 'AirPort4,107',   // device model
    ek: '1',          // ? from ApEx; setting to 1 enables iTunes; seems to use ALAC regardless of 'cn' setting
    sv: 'false',    // ? from ApEx
    da: 'true',     // ? from ApEx
    vn: '65537',    // ? from ApEx; maybe rsa key modulus? happens to be the same value
    fv: '76400.10', // ? from ApEx; maybe AirPort software version (7.6.4)
    sf: '0x5'       // ? from ApEx
  };

  this.netServer = null;
  this.rtspServer = new RtspServer(this.options, this);
}

util.inherits(NodeTunes, EventEmitter);

NodeTunes.prototype.start = function(callback) {
  debug('starting nodetunes server (%s)', this.options.serverName);
  if (!callback) {
    callback = function() {};
  }

  const port_opts = {
    min: 5000,
    max: 5050,
  };
  // Portastic is a pos
  portastic.find(port_opts).then((ports) => {
    const port = ports[0];
    const ch = this.rtspServer.connectHandler.bind(this.rtspServer);
    this.netServer = net.createServer(ch);
    this.mdnsName = this.options.macAddress + '@' + this.options.serverName;
    this.netServer.listen(port,() => {
      if (this.options.advertise) {
        mdns.createAdvertisement(mdns.tcp('raop'),port,{
          name: this.mdnsName,
          txtRecord: this.txtSetup,
        });
        debug('broadcasting mdns advertisement (for port %s)', port);
      } else {
        debug('server running without broadcast (on port %s)', port);
      }
      callback(null,{
        port,
        macAddress: this.options.macAddress,
      });
    });
  });
};

NodeTunes.prototype.stop = function() {
  debug('stopping nodetunes server');
  this.netServer.close();
};

module.exports = NodeTunes;
