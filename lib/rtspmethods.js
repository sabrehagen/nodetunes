'use strict';

var tools = require('./helper');
var ipaddr = require('ipaddr.js');
var randomstring = require('randomstring');
var crypto = require('crypto');
var debug = require('debug')('nodetunes:rtspmethods');

var SUPPORTED_CODECS = {
  '96 AppleLossless': true,
  '96 L16/44100/2': true
};

var AUDIO_LATENCY = '1000';

module.exports = function(rtspServer) {

  var nonce = '';

  var options = function(req, res) {

    res.set('Public',Object.keys(rtspServer.methodMapping).join(', '));

    if (req.getHeader('Apple-Challenge')) {

      // challenge response consists of challenge + ip address + mac address + padding to 32 bytes,
      // encrypted with the ApEx private key (private encryption mode w/ PKCS1 padding)

      var challengeBuf = new Buffer(req.getHeader('Apple-Challenge'), 'base64');

      var ipAddrRepr = ipaddr.parse(rtspServer.socket.address().address);
      if (ipAddrRepr.kind() === 'ipv6' && ipAddrRepr.isIPv4MappedAddress()) {
        ipAddrRepr = ipAddrRepr.toIPv4Address();
      }

      var ipAddr = new Buffer(ipAddrRepr.toByteArray());

      var macAddr = new Buffer(rtspServer.macAddress.replace(/:/g, ''), 'hex');
      res.set('Apple-Response', tools.generateAppleResponse(challengeBuf, ipAddr, macAddr));
    }

    res.send();
  };

  var announce = function(req, res) {
    req.content && debug(req.content.toString());

    if (rtspServer.clientConnected) {
      debug('already streaming; rejecting new client');
      res.status(453).send();
    } else if (rtspServer.options.password && !req.getHeader('Authorization')) {
      var md5sum = crypto.createHash('md5');
      md5sum.update = randomstring.generate();
      res.status(401);
      nonce = md5sum.digest('hex').toString('hex');

      res.set('WWW-Authenticate', 'Digest realm="roap", nonce="' + nonce + '"');
      res.send();

    } else if (rtspServer.options.password && req.getHeader('Authorization')) {

      var auth = req.getHeader('Authorization');

      var params = auth.split(/, /g);
      var map = {};
      params.forEach(function(param) {
        var pair = param.replace(/["]/g, '').split('=');
        map[pair[0]] = pair[1];
      });

      var expectedResponse = tools.generateRfc2617Response('iTunes', 'roap', rtspServer.options.password, nonce, map.uri, 'ANNOUNCE');
      var receivedResponse = map.response;

      if (expectedResponse === receivedResponse) {
        announceParse(req, res);
      } else {
        res.send(401);
      }

    } else if (req.content) {
      announceParse(req, res);
    } else {
      res.status(400).send();
    }
  };

  var announceParse = function(req, res) {
    let err = null;

    const sdp = tools.parseSdp(req.content.toString());

    for (var i = 0; i < sdp.a.length; i++) {
      var spIndex = sdp.a[i].indexOf(':');
      var aKey = sdp.a[i].substring(0, spIndex);
      var aValue = sdp.a[i].substring(spIndex + 1);

      if (aKey == 'rsaaeskey') {
        rtspServer.audioAesKey = tools.rsaPrivateKey.decrypt(new Buffer(aValue, 'base64').toString('binary'), 'RSA-OAEP');
      } else if (aKey == 'aesiv') {
        rtspServer.audioAesIv = new Buffer(aValue, 'base64');
      } else if (aKey == 'rtpmap') {
        if (SUPPORTED_CODECS[aValue]) {
          rtspServer.audioCodec = aValue;
        } else {
          debug('unsupported codec:',aValue);
          rtspServer.external.emit('error',{
            reason: 'unsupported_codec',
            codec: aValue,
          });
          err = 415;
        }
      } else if (aKey == 'fmtp') {
        rtspServer.audioOptions = aValue.split(' ');
      }
    }

    if (sdp.i) {
      rtspServer.metadata.clientName = sdp.i;
      debug('client name reported (%s)', rtspServer.metadata.clientName);
      rtspServer.external.emit('clientNameChange', sdp.i);
    }

    if (sdp.c) {
      if (sdp.c.indexOf('IP6') !== -1) {
        debug('ipv6 usage detected');
        rtspServer.ipv6 = true;
      }
    }

    if (err) {
      res.status(err).send();
    } else {
      debug('client considered connected');
      rtspServer.clientConnected = res.socket;
      const args = {
        audioCodec: rtspServer.audioCodec,
        audioOptions: rtspServer.audioOptions,
      };
      rtspServer.external.emit('clientConnected', args);
      res.send();
    }
  };

  var setup = function(req, res) {
    rtspServer.startRtp();
    res.set('Transport', 'RTP/AVP/UDP;unicast;mode=record;server_port=' + rtspServer.ports[0] + ';control_port=' + rtspServer.ports[1] + ';timing_port=' + rtspServer.ports[2]);
    res.set('Session', '1');
    res.set('Audio-Jack-Status', 'connected');
    res.send();
  };

  var record = function(req, res) {
    if (!req.getHeader('RTP-Info')) {
      debug("RTSP: RECORD no RTP INFO header, content:",req.content,"headers:",req.headers);
      res.set('Audio-Latency', AUDIO_LATENCY);
      res.send();
    } else {
      var rtpInfo = req.getHeader('RTP-Info').split(';');
      var initSeq = rtpInfo[0].split('=')[1];
      var initRtpTime = rtpInfo[1].split('=')[1];

      debug("RTSP: RECORD initSeq:",initSeq,"initRtpTime:",initRtpTime);
      if (!initSeq || !initRtpTime) {
        res.send(400);
      } else {
        res.set('Audio-Latency', AUDIO_LATENCY);
        res.send();
      }
    }
  };

  var flush = function(req, res) {
    rtspServer.external.emit('flush');
    res.set('RTP-Info', 'rtptime=1147914212'); // FIXME
    res.send();
  };

  var teardown = function(req, res) {
    rtspServer.external.emit('teardown');
    rtspServer.rtp.stop();
    res.send();
  };

  var setParameter = function(req, res) {
    if (req.getHeader('Content-Type') == 'application/x-dmap-tagged') {
      var dmapData = tools.parseDmap(req.content);
      rtspServer.metadata = dmapData;
      rtspServer.external.emit('metadataChange', rtspServer.metadata);
      debug('received metadata (%s)', JSON.stringify(rtspServer.metadata));
    } else if (req.getHeader('Content-Type') == 'image/jpeg') {
      rtspServer.metadata.artwork = req.content;
      rtspServer.external.emit('artworkChange', req.content);
      debug('received artwork (length: %s)', rtspServer.metadata.artwork.length);
    } else if (req.getHeader('Content-Type') == 'text/parameters') {

      var data = req.content.toString().split(': ');
      rtspServer.metadata = rtspServer.metadata || {};

      debug('received text metadata (%s: %s)', data[0], data[1].trim());

      if (data[0] == 'volume') {
        rtspServer.metadata.volume = parseFloat(data[1]);
        rtspServer.external.emit('volumeChange', rtspServer.metadata.volume);
      } else if (data[0] == 'progress') {
        rtspServer.metadata.progress = data[1];
        rtspServer.external.emit('progressChange', rtspServer.metadata.progress);
      } else {
        console.log("SET_PARAMETER: unhandled content:",req.content);
      }
    } else {
      console.log('SET_PARAMETER: unhandled, headers: %s, content: %s',JSON.stringify(req.headers),req.content);
    }
    res.send();
  };

  var getParameter = function(req, res) {
    console.log('GET_PARAMETER: uncaptured method: %s',req.content);
    res.send();
  };
  var post = function(req,res) {
    console.log('POST: uncaptured method: %s',req.content);
    res.send();
  };
  var get = function(req,res) {
    console.log('GET: uncaptured method: %s',req.content);
    res.send();
  };
  var put = function(req,res) {
    console.log('PUT: uncaptured method: %s',req.content);
    res.send();
  };

  return {
    ANNOUNCE: announce,
    SETUP: setup,
    RECORD: record,
    FLUSH: flush,
    TEARDOWN: teardown,
    OPTIONS: options,
    GET_PARAMETER: getParameter, // asked for by iOS?
    SET_PARAMETER: setParameter, // metadata, volume control
    POST: post,
    GET: get,
    PUT: put,
  };
};
