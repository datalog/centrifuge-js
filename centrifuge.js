function myCentrifuge( url, configuration ) {

	var
	 global = window

	,_errorTimeout = 'timeout'
	,_errorConnectionClosed = 'connection closed'

	,R = 'object' === typeof Reflect ? Reflect : null

	,ReflectApply = R && 'function' === typeof R.apply
		? R.apply
		: function ReflectApply( target, receiver, args ) {

			return Function.prototype.apply.call( target, receiver, args );
		};

	function emit( type ) {

		var
		args = [];

		for( var i = 1; i < arguments.length; i++ ) {

			args.push( arguments[ i ] );
		}

		var
		doError = ('error' === type ),
		events = this._events;

		if( undefined !== events ) {

			doError = ( doError && undefined === events.error );
		}

		else if( !doError ) {

			return false;
		}

		// If there is no 'error' event listener then throw.
		if( doError ) {

			var
			er;

			if( args.length > 0 ) {

				er = args[ 0 ];
			}

			if( er instanceof Error ) {

				// Note: The comments on the `throw` lines are intentional, they show
				// up in Node's output if this results in an unhandled exception.
				throw er; // Unhandled 'error' event
			}

			// At least give some kind of context to the user
			var
			err = new Error('Unhandled error.' + (er ? ' (' + er.message + ')' : ''));
			err.context = er;

			throw err; // Unhandled 'error' event
		}

		var
		handler = events[ type ];

		if( undefined === handler ) {

			return false;
		}

		if('function' === typeof handler ) {

			ReflectApply( handler, this, args );

		} else {

			var
			len = handler.length,
			listeners = arrayClone( handler, len );

			for( var i = 0; i < len; ++i ) {

				ReflectApply( listeners[ i ], this, args );
			}
		}

		return true;
	};

	function addListener( target, type, listener, prepend ) {

		if('function' !== typeof listener ) {

			throw new TypeError('The "listener" argument must be of type Function. Received type ' + typeof listener);
		}

		var
		m = 10,

		existing,
		events = target._events;

		if( undefined === events ) {

			events = target._events = Object.create( null );
			target._eventsCount = 0;

		} else {
			// To avoid recursion in the case that type === "newListener"! Before
			// adding it to the listeners, first emit "newListener".
			if( undefined !== events.newListener ) {

				target.emit('newListener', type, listener.listener ? listener.listener : listener );

				// Re-assign `events` because a newListener handler could have caused the
				// this._events to be assigned to a new object
				events = target._events;
			}
			existing = events[ type ];
		}

		if( undefined === existing ) {
			// Optimize the case of one listener. Don't need the extra array object.
			existing = events[ type ] = listener;
			++target._eventsCount;
		} else {

			if('function' === typeof existing ) {
				// Adding the second element, need to change to array.
				existing = events[ type ] =
					prepend ? [ listener, existing ] : [ existing, listener ];
				// If we've already got an array, just append.
			} else if( prepend ) {

				existing.unshift( listener );
			} else {

				existing.push( listener );
			}

			// Check for listener leak
			//m = $getMaxListeners( target );

			if( m > 0 && existing.length > m && !existing.warned ) {

				existing.warned = true;
				// No error code for this since it is a Warning
				// eslint-disable-next-line no-restricted-syntax
				var
				w = new Error('Possible EventEmitter memory leak detected. ' +
						existing.length + ' ' + String(type) + ' listeners ' +
						'added. Use emitter.setMaxListeners() to ' +
						'increase limit');

				w.name = 'MaxListenersExceededWarning';
				w.emitter = target;
				w.type = type;
				w.count = existing.length;

				console.warn( w );
			}
		}

		return target;
	};

	function startsWith( value, prefix ) {

		return 0 === value.lastIndexOf( prefix, 0 );
	};

	function isFunction( value ) {

		if( undefined === value || null === value ) {

			return false;
		}

		return 'function' === typeof value;
	};

	function log( level, args ) {

		if( global.console ) {

			var
			logger = global.console[ level ];

			if( isFunction( logger ) ) {

				logger.apply( global.console, args );
			}
		}
	};

	function backoff( step, min, max ) {

		var
		jitter = 0.5 * Math.random(),
		interval = Math.min( max, min * Math.pow( 2, step + 1 ) );

		return Math.floor( ( 1 - jitter ) * interval );
	};

	function errorExists( data ) {

		return 'error' in data && null !== data.error;
	};

	function extend( a, b ) {

		for ( var key in b ) {

			if( b.hasOwnProperty( key ) ) {

				a[ key ] = b[ key ];
			}
		}

		return a;
	};

/**************************/

	function JsonEncoder() {

		return this;
	};

	JsonEncoder.prototype = {

		encodeCommands
		: function( commands ) {

			var
			encodedCommands = [];

			for( var i in commands ) {

				if(commands.hasOwnProperty( i ) ) {

					encodedCommands.push( JSON.stringify( commands[ i ] ) );
				}
			}
			return encodedCommands.join('\n');
		}
	};

/**************************/

	function JsonDecoder() {

		return this;
	};

	JsonDecoder.prototype = {

		 decodeReplies
		: function( data ) {

			var
			replies = [],
			encodedReplies = data.split('\n');

			for( var i in encodedReplies ) {

				if(encodedReplies.hasOwnProperty( i ) ) {

					if(!encodedReplies[ i ] ) {

						continue;
					}

					var
					reply = JSON.parse(encodedReplies[ i ]);

					replies.push(reply);
				}
			}

			return replies;
		}

		,decodeCommandResult
		: function decodeCommandResult( methodType, data ) {

			return data;
		}

		,decodePush
		: function decodePush( data ) {

			return data;
		}

		,decodePushData
		: function decodePushData( pushType, data ) {

			return data;
		}
	};


/**************************/

	var
	 _STATE_NEW			=  0
	,_STATE_SUBSCRIBING		=  1
	,_STATE_SUCCESS			=  2
	,_STATE_ERROR			=  3
	,_STATE_UNSUBSCRIBED		=  4;

	function Subscription( centrifuge, channel, events ) {

		var
		o = this;

		o.channel		= channel;
		o._centrifuge		= centrifuge;
		o._status		= _STATE_NEW;
		o._error		= null;
		o._isResubscribe	= false;
		o._ready		= false;
		o._subscriptionPromise	= null;
		o._noResubscribe	= false;
		o._recoverable		= false;
		o._recover		= false;
		o._promises		= {};
		o._promiseId		= 0;

		o._setEvents( events );
		o._initializePromise();

		o.on('error', function( errContext ) {

			o._centrifuge._debug('subscription error', errContext );
		});

		return o;
	};

	Subscription.prototype = {

		 on
		: function( type, listener ) {

			return addListener( this, type, listener, false );
		}

		,emit
		: emit

		,_nextPromiseId
		: function() {

			return ++this._promiseId;
		}

		,_initializePromise
		: function() {

			var
			o = this;

			// this helps us to wait until subscription will successfully
			// subscribe and call actions such as presence, history etc in
			// synchronous way.
			o._ready = false;

			o._subscriptionPromise = new Promise( function( resolve, reject ) {

				o._resolve = function( value ) {

					o._ready = true;
					resolve( value );
				};

				o._reject = function( err ) {

					o._ready = true;
					reject( err );
				};

			}).then( function() {}, function() {});
		}

		,_needRecover
		: function() {

			return this._recoverable === true && this._recover === true;
		}

		,_setEvents
		: function( events ) {

			if( !events ) {

				return;
			}

			if( isFunction( events ) ) {
				// events is just a function to handle publication received from channel.
				this.on('publish', events);

			} else if( Object.prototype.toString.call( events ) === Object.prototype.toString.call({}) ) {

				var
				knownEvents = [
					 'publish'
					,'join'
					,'leave'
					,'unsubscribe'
					,'subscribe'
					,'error'
				];

				for( var i = 0, l = knownEvents.length; i < l; i++ ) {

					var
					ev = knownEvents[ i ];

					if( ev in events ) {

						this.on(ev, events[ev]);
					}
				}
			}
		}

		,_isNew
		: function() {

			return this._status === _STATE_NEW;
		}

		,_isUnsubscribed
		: function() {

			return this._status === _STATE_UNSUBSCRIBED;
		}

		,_isSubscribing
		: function() {

			return this._status === _STATE_SUBSCRIBING;
		}

		,_isReady
		: function() {

			return this._status === _STATE_SUCCESS || this._status === _STATE_ERROR;
		}

		,_isSuccess
		: function() {

			return this._status === _STATE_SUCCESS;
		}

		,_isError
		: function() {

			return this._status === _STATE_ERROR;
		}

		,_setNew
		: function() {

			this._status = _STATE_NEW;
		}

		,_setSubscribing
		: function( isResubscribe ) {

			var
			o = this;

			o._isResubscribe = isResubscribe || false;
			if( true === o._ready ) {
				// new promise for this subscription
				o._initializePromise();
			}

			o._status = _STATE_SUBSCRIBING;
		}

		,_setSubscribeSuccess
		: function( recovered ) {

			var
			o = this;

			if( o._status === _STATE_SUCCESS ) {

				return;
			}

			o._status = _STATE_SUCCESS;

			var
			successContext = o._getSubscribeSuccessContext( recovered );

			o._recover = false;

			o.emit('subscribe', successContext );

			o._resolve( successContext );

			for( var id in o._promises ) {

				clearTimeout( o._promises[ id ].timeout );

				o._promises[ id ].resolve();

				delete o._promises[ id ];
			}
		}

		,_setSubscribeError
		: function( err ) {

			var
			o = this;

			if( o._status === _STATE_ERROR ) {

				return;
			}

			o._status = _STATE_ERROR;
			o._error = err;

			var
			errContext = o._getSubscribeErrorContext();

			o.emit('error', errContext);

			o._reject(errContext);

			for( var id in o._promises ) {

				clearTimeout( o._promises[ id ].timeout );

				o._promises[ id ].reject( err );

				delete o._promises[ id ];
			}
		}

		,_triggerUnsubscribe
		: function() {

			this.emit('unsubscribe', {

				channel: this.channel
			});
		}

		,_setUnsubscribed
		: function( noResubscribe ) {

			var
			o = this;

			o._centrifuge._clearSubRefreshTimeout( o.channel );

			if( this._status === _STATE_UNSUBSCRIBED ) {

				return;
			}

			var
			needTrigger = o._status === _STATE_SUCCESS;

			o._status = _STATE_UNSUBSCRIBED;

			if( true === noResubscribe ) {

				o._recover = false;
				o._noResubscribe = true;

				delete o._centrifuge._lastSeq[ o.channel ];
				delete o._centrifuge._lastGen[ o.channel ];
				delete o._centrifuge._lastEpoch[ o.channel ];
			}

			if( needTrigger ) {

				o._triggerUnsubscribe();
			}
		}

		,_shouldResubscribe
		: function() {

			return !this._noResubscribe;
		}

		,_getSubscribeSuccessContext
		: function( recovered ) {

			return {
				channel: this.channel,
				isResubscribe: this._isResubscribe,
				recovered: recovered
			};
		}

		,_getSubscribeErrorContext
		: function() {

			var
			o = this,
			subscribeErrorContext = o._error;

			subscribeErrorContext.channel = o.channel;
			subscribeErrorContext.isResubscribe = o._isResubscribe;

			return subscribeErrorContext;
		}

		,ready
		: function( callback, errback ) {

			var
			o = this;

			if( o._ready ) {
				if( o._isSuccess() ) {

					callback( o._getSubscribeSuccessContext() );

				} else {

					errback( o._getSubscribeErrorContext() );
				}
			}
		}

		,subscribe
		: function() {

			var
			o = this;

			if( o._status === _STATE_SUCCESS ) {

				return;
			}
			o._noResubscribe = false;
			o._centrifuge._subscribe( o );
		}

		,unsubscribe
		: function() {

			var
			o = this;

			o._setUnsubscribed( true );
			o._centrifuge._unsubscribe( o );
		}

		,_methodCall
		: function( message, type ) {

			var
			o = this,
			methodCallPromise = new Promise( function( resolve, reject ) {

				var
				subPromise = void 0;

				if( o._isSuccess() ) {

					subPromise = Promise.resolve();

				} else if( o._isError() ) {

					subPromise = Promise.reject(o._error);

				} else {

					subPromise = new Promise( function( res, rej ) {

						var
						timeout = setTimeout( function() {

							rej({ 'code': 0, 'message': 'timeout' });

						}, o._centrifuge._config.timeout );

						o._promises[o._nextPromiseId()] = {

							timeout: timeout,
							resolve: res,
							reject: rej
						};
					});
				}

				subPromise.then( function() {

					return o._centrifuge._call( message ).then( function( resolveCtx ) {

						resolve( o._centrifuge._decoder.decodeCommandResult( type, resolveCtx.result ) );

						if( resolveCtx.next ) {

							resolveCtx.next();
						}

					}, function( rejectCtx ) {

						reject( rejectCtx.error );

						if( rejectCtx.next ) {

							rejectCtx.next();
						}
					});
				}, function( error ) {

					reject( error );
				});
			});

			return methodCallPromise;
		}

		,publish
		: function( data ) {

			var
			o = this;

			return o._methodCall({
				method: o._centrifuge._methodType.PUBLISH,
				params: {
					channel: o.channel,
					data: data
				}
			}, o._centrifuge._methodType.PUBLISH);
		}

		,presence
		: function() {

			var
			o = this;

			return o._methodCall({
				method: o._centrifuge._methodType.PRESENCE,
				params: {
					channel: o.channel
				}
			}, o._centrifuge._methodType.PRESENCE);
		}

		,presenceStats
		: function() {

			var
			o = this;

			return o._methodCall({
				method: o._centrifuge._methodType.PRESENCE_STATS,
				params: {
					channel: o.channel
				}
			}, o._centrifuge._methodType.PRESENCE_STATS);
		}

		,history
		: function() {

			var
			o = this;

			return o._methodCall({
				method: o._centrifuge._methodType.HISTORY,
				params: {
					channel: o.channel
				}
			}, o._centrifuge._methodType.HISTORY);
		}
	};


	function Centrifuge() {

		var
		o = this;

		o._url			= url;
		o._websocket		= null;
		o._sockjs		= null;
		o._isSockjs		= false;
		o._binary		= false;
		o._methodType		= {
						 CONNECT		:  0
						,SUBSCRIBE		:  1
						,UNSUBSCRIBE		:  2
						,PUBLISH		:  3
						,PRESENCE		:  4
						,PRESENCE_STATS		:  5
						,HISTORY		:  6
						,PING			:  7
						,SEND			:  8
						,RPC			:  9
						,REFRESH		: 10
						,SUB_REFRESH		: 11

		};
		o._pushType		= {
						 PUBLICATION		:  0
						,JOIN			:  1
						,LEAVE			:  2
						,UNSUB			:  3
						,MESSAGE		:  4
						,SUB			:  5
		};
		o._encoder			= null;
		o._decoder			= null;
		o._status			= 'disconnected';
		o._reconnect			= true;
		o._reconnecting			= false;
		o._transport			= null;
		o._transportName		= null;
		o._transportClosed 		= true;
		o._messageId 			= 0;
		o._clientID 			= null;
		o._refreshRequired 		= false;
		o._subs 			= {};
		o._serverSubs 			= {};
		o._lastSeq			= {};
		o._lastGen			= {};
		o._lastOffset			= {};
		o._lastEpoch			= {};
		o._messages			= [];
		o._isBatching			= false;
		o._isSubscribeBatching		= false;
		o._privateChannels		= {};
		o._numRefreshFailed		= 0;
		o._refreshTimeout		= null;
		o._pingTimeout			= null;
		o._pongTimeout			= null;
		o._subRefreshTimeouts		= {};
		o._retries			= 0;
		o._callbacks			= {};
		o._latency			= null;
		o._latencyStart			= null;
		o._connectData			= null;
		o._token			= null;
		o._xhrID			= 0;
		o._xhrs				= {};
		o._dispatchPromise		= Promise.resolve();
		o._config = {
			debug			: false,
			websocket		: null,
			sockjs			: null,
			promise			: null,
			minRetry		: 1000,
			maxRetry		: 20000,
			timeout			: 5000,
			ping			: true,
			pingInterval		: 25000,
			pongWaitTimeout		: 5000,
			privateChannelPrefix	: '$',
			onTransportClose	: null,
			sockjsServer		: null,
			sockjsTransports	: [
							'websocket',
							'xdr-streaming',
							'xhr-streaming',
							'eventsource',
							'iframe-eventsource',
							'iframe-htmlfile',
							'xdr-polling',
							'xhr-polling',
							'iframe-xhr-polling',
							'jsonp-polling'
			],
			refreshEndpoint		: '/centrifuge/refresh',
			refreshHeaders		: {},
			refreshParams		: {},
			refreshData		: {},
			refreshAttempts		: null,
			refreshInterval		: 1000,
			onRefreshFailed		: null,
			onRefresh		: null,
			subscribeEndpoint	: '/centrifuge/subscribe',
			subscribeHeaders	: {},
			subscribeParams		: {},
			subRefreshInterval	: 1000,
			onPrivateSubscribe	: null
		};

		o._configure( configuration );

		return o;
	};

	Centrifuge.prototype = {

		 on
		: function( type, listener ) {

			return addListener( this, type, listener, false );
		}

		,emit
		: emit

		,setToken
		: function( token ) {

			this._token = token;
		}

		,setConnectData
		: function( data ) {

			this._connectData = data;
		}

		,setRefreshHeaders
		: function( headers ) {

			this._config.refreshHeaders = headers;
		}

		,setRefreshParams
		: function( params ) {

			this._config.refreshParams = params;
		}

		,setRefreshData
		: function( data ) {

			this._config.refreshData = data;
		}

		,setSubscribeHeaders
		: function( headers ) {

			this._config.subscribeHeaders = headers;
		}

		,setSubscribeParams
		: function( params ) {

			this._config.subscribeParams = params;
		}

		,_ajax
		: function( url, params, headers, data, callback ) {

			var
			o = this,
			query = '';

			o._debug('sending AJAX request to', url, 'with data', JSON.stringify( data ) );

			var xhr = global.XMLHttpRequest ? new global.XMLHttpRequest() : new global.ActiveXObject('Microsoft.XMLHTTP');

			for( var i in params ) {

				if( params.hasOwnProperty( i ) ) {
					if( query.length > 0 ) {

						query += '&';
					}

					query += encodeURIComponent( i ) + '=' + encodeURIComponent(params[ i ]);
				}
			}

			if( query.length > 0 ) {

				query = '?' + query;
			}

			xhr.open('POST', url + query, true );

			if('withCredentials' in xhr ) {

				xhr.withCredentials = true;
			}

			xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
			xhr.setRequestHeader('Content-Type', 'application/json');

			for( var headerName in headers ) {

				if( headers.hasOwnProperty( headerName ) ) {
					xhr.setRequestHeader( headerName, headers[ headerName ] );
				}
			}

			xhr.onreadystatechange = function() {

				if( 4 === xhr.readyState ) {

					if( 200 === xhr.status ) {

						var
						_data = void 0,
						parsed = false;

						try {
							_data = JSON.parse(xhr.responseText);
							parsed = true;

						} catch( e ) {

							callback({
								error: 'Invalid JSON. Data was: ' + xhr.responseText,
								status: 200,
								data: null
							});
						}
						if( parsed ) {
							// prevents double execution.
							callback({
								data: _data,
								status: 200
							});
						}
					} else {

						o._log('wrong status code in AJAX response', xhr.status );

						callback({
							status: xhr.status,
							data: null
						});
					}
				}
			};
			setTimeout( function() {

				return xhr.send( JSON.stringify( data ) );
			}, 20 );

			return xhr;
		}

		,_log
		: function() {

			log('info', arguments);
		}

		,_debug
		: function() {

			if( this._config.debug === true ) {

				log('debug', arguments );
			}
		}

		,_websocketSupported
		: function() {

			if( null !== this._config.websocket ) {

				return true;
			}

			return !('function' !== typeof WebSocket && ('undefined' === typeof WebSocket ? 'undefined' : _typeof( WebSocket ) ) !== 'object');
		}

		,_setFormat
		: function( format ) {

			var
			o = this;

			if( o._formatOverride( format ) ) {

				return;
			}

			if( format === 'protobuf' ) {

				throw new Error('not implemented by JSON only Centrifuge client – use client with Protobuf');
			}

			o._binary = false;
//			o._methodType = _json.JsonMethodType;
//			o._pushType = _json.JsonPushType;
			o._encoder = new JsonEncoder();
			o._decoder = new JsonDecoder();
		}

		,_formatOverride
		: function( format ) {

			return false;
		}

		,_configure
		: function( configuration ) {

			var
			o = this;

			if( !('Promise' in global) ) {
				throw new Error('Promise polyfill required');
			}

			extend( o._config, configuration || {} );

			o._debug('centrifuge config', o._config);

			if( !o._url ) {

				throw new Error('url required');
			}

			if( startsWith( o._url, 'ws') && o._url.indexOf('format=protobuf') > -1 ) {

				o._setFormat('protobuf');
			} else {

				o._setFormat('json');
			}

			if( startsWith( o._url, 'http') ) {

				o._debug('client will try to connect to SockJS endpoint');

				if( null !== o._config.sockjs ) {

					o._debug('SockJS explicitly provided in options');

					o._sockjs = o._config.sockjs;

				} else {

					if('undefined' === typeof global.SockJS ) {

						throw new Error('SockJS not found, use ws:// in url or include SockJS');
					}

					o._debug('use globally defined SockJS');
					o._sockjs = global.SockJS;
				}
			} else {

				o._debug('client will connect to websocket endpoint');
			}
		}

		,_setStatus
		: function( newStatus ) {

			if( this._status !== newStatus ) {

				this._debug('Status', this._status, '->', newStatus);
				this._status = newStatus;
			}
		}

		,_isDisconnected
		: function() {

			return this._status === 'disconnected';
		}

		,_isConnecting
		: function() {

			return this._status === 'connecting';
		}

		,_isConnected
		: function() {

			return this._status === 'connected';
		}

		,_nextMessageId
		: function() {

			return ++this._messageId;
		}

		,_resetRetry
		: function() {

			this._debug('reset retries count to 0');
			this._retries = 0;
		}

		,_getRetryInterval
		: function() {

			var
			o = this,
			interval = backoff( o._retries, o._config.minRetry, o._config.maxRetry );

			o._retries += 1;

			return interval;
		}

		,_abortInflightXHRs
		: function() {

			var
			o = this;

			for( var xhrID in o._xhrs ) {
				try {
					o._xhrs[ xhrID ].abort();

				} catch( e ) {

					o._debug('error aborting xhr', e);
				}

				delete o._xhrs[ xhrID ];
			}
		}

		,_clearConnectedState
		: function( reconnect ) {

			var
			o = this;

			o._clientID = null;
			o._stopPing();

			// fire errbacks of registered outgoing calls.
			for( var id in o._callbacks ) {
				if( o._callbacks.hasOwnProperty( id ) ) {

					var
					callbacks = o._callbacks[ id ];

					clearTimeout( callbacks.timeout );

					var
					errback = callbacks.errback;

					if( !errback ) {
						continue;
					}

					errback({ error: o._createErrorObject('disconnected') });
				}
			}

			o._callbacks = {};

			// fire unsubscribe events
			for( var channel in o._subs ) {
				if( o._subs.hasOwnProperty( channel ) ) {

					var
					sub = o._subs[ channel ];

					if( reconnect ) {

						if( sub._isSuccess() ) {

							sub._triggerUnsubscribe();
							sub._recover = true;
						}

						if( sub._shouldResubscribe() ) {

							sub._setSubscribing();
						}

					} else {

						sub._setUnsubscribed();
					}
				}
			}

			o._abortInflightXHRs();

			// clear refresh timer
			if( null !== o._refreshTimeout ) {

				clearTimeout( o._refreshTimeout );

				o._refreshTimeout = null;
			}

			// clear sub refresh timers
			for( var channel in o._subRefreshTimeouts ) {

				if( o._subRefreshTimeouts.hasOwnProperty( channel ) && o._subRefreshTimeouts[ channel ] ) {

					o._clearSubRefreshTimeout( channel );
				}
			}

			o._subRefreshTimeouts = {};

			if( !o._reconnect ) {
				// completely clear subscriptions
				o._subs = {};
			}
		}

		,_isTransportOpen
		: function() {

			var
			o = this;

			if( o._isSockjs ) {

				return o._transport && o._transport.transport && o._transport.transport.readyState === o._transport.transport.OPEN;
			}
			return o._transport && o._transport.readyState === o._transport.OPEN;
		}

		,_transportSend
		: function( commands ) {

			var
			o = this;

			if( !commands.length ) {

				return true;
			}

			if( !o._isTransportOpen() ) {
				// resolve pending commands with error if transport is not open
				for( var command in commands ) {

					var
					id = command.id;

					if( !(id in o._callbacks) ) {

						continue;
					}

					var
					callbacks = o._callbacks[ id ];

					clearTimeout( o._callbacks[ id ].timeout );

					delete o._callbacks[ id ];

					var
					errback = callbacks.errback;
					errback({ error: o._createErrorObject(_errorConnectionClosed, 0) });
				}
				return false;
			}

			o._transport.send( o._encoder.encodeCommands(commands) );

			return true;
		}

		,_setupTransport
		: function() {

			var
			o = this;

			o._isSockjs = false;

			// detect transport to use - SockJS or Websocket
			if( null !== o._sockjs ) {

				var
				sockjsOptions = {

					transports: o._config.sockjsTransports
				};

				if( null !== o._config.sockjsServer ) {

					sockjsOptions.server = o._config.sockjsServer;
				}

				o._isSockjs = true;
				o._transport = new o._sockjs( o._url, null, sockjsOptions );

			} else {

				if( !o._websocketSupported() ) {

					o._debug('No Websocket support and no SockJS configured, can not connect');
					return;
				}
				if( null !== o._config.websocket ) {

					o._websocket = o._config.websocket;
				} else {

					o._websocket = WebSocket;
				}

				o._transport = new o._websocket( o._url );

				if( true === o._binary ) {

					o._transport.binaryType = 'arraybuffer';
				}
			}

			o._transport.onopen = function() {

				o._transportClosed = false;

				if( o._isSockjs ) {

					o._transportName = 'sockjs-' + o._transport.transport;

					o._transport.onheartbeat = function() {

						return o._restartPing();
					};

				} else {

					o._transportName = 'websocket';
				}

				// Can omit method here due to zero value.
				var msg = {
					// method: this._methodType.CONNECT
				};

				if( o._token || o._connectData ) {

					msg.params = {};
				}

				if( o._token ) {

					msg.params.token = o._token;
				}

				if( o._connectData ) {

					msg.params.data = o._connectData;
				}

				var
				subs = {},
				hasSubs = false;

				for( var channel in o._serverSubs ) {

					if( o._serverSubs.hasOwnProperty( channel ) && o._serverSubs[ channel ].recoverable ) {

						hasSubs = true;

						var
						sub = {
							'recover': true
						};

						if( o._serverSubs[ channel ].seq || o._serverSubs[ channel ].gen ) {

							if( o._serverSubs[ channel ].seq ) {

								sub['seq'] = o._serverSubs[ channel ].seq;
							}

							if( o._serverSubs[ channel ].gen ) {

								sub['gen'] = o._serverSubs[ channel ].gen;
							}
						} else {
							if( o._serverSubs[ channel ].offset ) {

								sub['offset'] = o._serverSubs[ channel ].offset;
							}
						}

						if( o._serverSubs[ channel ].epoch ) {

							sub['epoch'] = o._serverSubs[ channel ].epoch;
						}

						subs[ channel ] = sub;
					}
				}

				if( hasSubs ) {

					if( !msg.params ) {

						msg.params = {};
					}

					msg.params.subs = subs;
				}

				o._latencyStart = new Date();
				o._call( msg ).then( function( resolveCtx ) {

					o._connectResponse( o._decoder.decodeCommandResult( o._methodType.CONNECT, resolveCtx.result ), hasSubs );

					if( resolveCtx.next ) {

						resolveCtx.next();
					}
				}, function( rejectCtx ) {

					var
					err = rejectCtx.error;

					if( 109 === err.code ) {
						// token expired.
						o._refreshRequired = true;
					}

					o._disconnect('connect error', true);

					if( rejectCtx.next ) {

						rejectCtx.next();
					}
				});
			};

			o._transport.onerror = function( error ) {

				o._debug('transport level error', error);
			};

			o._transport.onclose = function( closeEvent ) {

				o._transportClosed = true;

				var
				reason = _errorConnectionClosed,
				needReconnect = true;

				if( closeEvent && 'reason' in closeEvent && closeEvent.reason ) {

					try {
						var
						advice = JSON.parse( closeEvent.reason );

						o._debug('reason is an advice object', advice);

						reason = advice.reason;
						needReconnect = advice.reconnect;

					} catch( e ) {

						reason = closeEvent.reason;
						o._debug('reason is a plain string', reason);
					}
				}

				// onTransportClose callback should be executed every time transport was closed.
				// This can be helpful to catch failed connection events (because our disconnect
				// event only called once and every future attempts to connect do not fire disconnect
				// event again).
				if( null !== o._config.onTransportClose ) {

					o._config.onTransportClose({
						event: closeEvent,
						reason: reason,
						reconnect: needReconnect
					});
				}

				o._disconnect(reason, needReconnect);

				if( true === o._reconnect ) {

					o._reconnecting = true;

					var
					interval = o._getRetryInterval();

					o._debug('reconnect after ' + interval + ' milliseconds');

					setTimeout( function() {

						if( true === o._reconnect ) {

							if( o._refreshRequired ) {

								o._refresh();
							} else {

								o._connect();
							}
						}

					}, interval);
				}
			};

			o._transport.onmessage = function( event ) {

				o._dataReceived(event.data);
			};
		}

		,rpc
		: function( data ) {

			return this._rpc('', data);
		}

		,namedRPC
		: function( method, data ) {

			return this._rpc(method, data);
		}

		,_rpc
		: function( method, data ) {

			var
			o = this,
			params = {
				data: data
			};

			if('' !== method ) {

				params.method = method;
			};

			var
			msg = {
				method: o._methodType.RPC,
				params: params
			};

			if( !o.isConnected() ) {

				return Promise.reject( o._createErrorObject( _errorConnectionClosed, 0 ) );
			}

			return o._call( msg ).then( function( resolveCtx ) {

				if( resolveCtx.next ) {

					resolveCtx.next();
				}

				return o._decoder.decodeCommandResult( o._methodType.RPC, resolveCtx.result );

			}, function( rejectCtx ) {

				if( rejectCtx.next ) {

					rejectCtx.next();
				}

				return Promise.reject( rejectCtx.error );
			});
		}

		,send
		: function( data ) {

			var
			o = this,
			msg = {
				method: o._methodType.SEND,
				params: {
					data: data
				}
			};

			if( !o.isConnected() ) {

				return Promise.reject( o._createErrorObject( _errorConnectionClosed, 0 ) );
			}

			var
			sent = o._transportSend([ msg ]); // can send async message to server without id set

			if( !sent ) {

				return Promise.reject(o._createErrorObject(_errorConnectionClosed, 0));
			};

			return Promise.resolve({});
		}

		,publish
		: function( channel, data ) {

			var
			o = this,
			msg = {
				method: o._methodType.PUBLISH,
				params: {
					channel: channel,
					data: data
				}
			};

			if( !o.isConnected() ) {

				return Promise.reject( o._createErrorObject( _errorConnectionClosed, 0 ));
			}

			return o._call( msg ).then( function( result ) {

				if( result.next ) {

					result.next();
				}

				return {};
			});
		}

		,_dataReceived
		: function( data ) {

			var
			o = this,
			replies = o._decoder.decodeReplies( data );
			// we have to guarantee order of events in replies processing - i.e. start processing
			// next reply only when we finished processing of current one. Without syncing things in
			// this way we could get wrong publication events order as reply promises resolve
			// on next loop tick so for loop continues before we finished emitting all reply events.
			o._dispatchPromise = o._dispatchPromise.then( function() {

				var
				finishDispatch = void 0;

				o._dispatchPromise = new Promise(function( resolve ) {

					finishDispatch = resolve;
				});

				o._dispatchSynchronized( replies, finishDispatch );
			});

			o._restartPing();
		}

		,_dispatchSynchronized
		: function( replies, finishDispatch ) {

			var
			o = this,
			p = Promise.resolve(),

			_loop = function( i ) {

				if( replies.hasOwnProperty( i ) ) {

					p = p.then( function() {

						return o._dispatchReply( replies[ i ] );
					});
				}
			};

			for( var i in replies ) {

				_loop( i );
			}

			p = p.then( function() {

				finishDispatch();
			});
		}

		,_dispatchReply
		: function( reply ) {

			var
			next,
			o = this,
			p = new Promise( function( resolve ) {

				next = resolve;
			});

			if( undefined === reply || null === reply ) {

				o._debug('dispatch: got undefined or null reply');

				next();

				return p;
			}

			var
			id = reply.id;

			if( id && id > 0 ) {

				o._handleReply(reply, next);

			} else {

				o._handlePush(reply.result, next);
			}

			return p;
		}

		,_call
		: function( msg ) {

			var
			o = this;

			return new Promise(function( resolve, reject ) {

				var
				id = o._addMessage( msg );
				o._registerCall( id, resolve, reject );
			});
		}

		,_connect
		: function() {

			var
			o = this;

			if( o.isConnected() ) {

				o._debug('connect called when already connected');
				return;
			}
			if( o._status === 'connecting' ) {

				return;
			}

			o._debug('start connecting');

			o._setStatus('connecting');
			o._clientID = null;
			o._reconnect = true;
			o._setupTransport();
		}

		,_disconnect
		: function( reason, shouldReconnect ) {

			var
			o = this,
			reconnect = shouldReconnect || false;

			if( reconnect === false ) {

				o._reconnect = false;
			}

			if( o._isDisconnected() ) {

				if( !reconnect ) {

					o._clearConnectedState( reconnect );
				}

				return;
			}

			o._clearConnectedState( reconnect );

			o._debug('disconnected:', reason, shouldReconnect );

			o._setStatus('disconnected');

			if( o._refreshTimeout ) {

				clearTimeout( o._refreshTimeout );
				o._refreshTimeout = null;
			}

			if( o._reconnecting === false ) {
				// fire unsubscribe events for server side subs.
				for( var channel in o._serverSubs ) {

					if( o._serverSubs.hasOwnProperty( channel ) ) {

						o.emit('unsubscribe', { channel: channel });
					}
				}

				o.emit('disconnect', {
					reason: reason,
					reconnect: reconnect
				});
			}

			if( reconnect === false ) {

				o._subs = {};
				o._serverSubs = {};
			}

			if( !o._transportClosed ) {

				o._transport.close();
			}
		}

		,_refreshFailed
		: function() {

			var
			o = this;

			o._numRefreshFailed = 0;

			if( !o._isDisconnected() ) {

				o._disconnect('refresh failed', false );
			}

			if( null !== o._config.onRefreshFailed ) {

				o._config.onRefreshFailed();
			}
		}

		,_refresh
		: function() {

			var
			o = this;

			// ask application for new connection token.
			o._debug('refresh token');

			if( 0 === o._config.refreshAttempts ) {

				o._debug('refresh attempts set to 0, do not send refresh request at all');

				o._refreshFailed();

				return;
			}

			if( null !== o._refreshTimeout ) {

				clearTimeout( o._refreshTimeout);

				o._refreshTimeout = null;
			}

			var
			clientID = o._clientID,
			xhrID = o._newXHRID(),

			cb = function( resp ) {

				if( xhrID in o._xhrs ) {

					delete o._xhrs[ xhrID ];
				}

				if( o._clientID !== clientID ) {

					return;
				}

				if( resp.error || 200 !== resp.status ) {
					// We don't perform any connection status related actions here as we are
					// relying on server that must close connection eventually.
					if( resp.error ) {

						o._debug('error refreshing connection token', resp.error);

					} else {

						o._debug('error refreshing connection token: wrong status code', resp.status);
					}

					o._numRefreshFailed++;

					if( null !== o._refreshTimeout ) {

						clearTimeout(o._refreshTimeout);

						o._refreshTimeout = null;
					}

					if( null !== o._config.refreshAttempts && o._numRefreshFailed >= o._config.refreshAttempts ) {

						o._refreshFailed();

						return;
					}

					var
					jitter = Math.round(Math.random() * 1000 * Math.max( o._numRefreshFailed, 20 )),
					interval = o._config.refreshInterval + jitter;

					o._refreshTimeout = setTimeout( function() {

						return o._refresh();

					}, interval);

					return;
				}

				o._numRefreshFailed = 0;
				o._token = resp.data.token;

				if( !o._token ) {

					o._refreshFailed();
					return;
				}

				if( o._isDisconnected() && o._reconnect ) {

					o._debug('token refreshed, connect from scratch');

					o._connect();

				} else {

					o._debug('send refreshed token');

					var
					msg = {
						method: o._methodType.REFRESH,
						params: {
							token: o._token
						}
					};

					o._call( msg ).then(function( resolveCtx ) {

						o._refreshResponse( o._decoder.decodeCommandResult( o._methodType.REFRESH, resolveCtx.result ));

						if( resolveCtx.next ) {

							resolveCtx.next();
						}

					}, function( rejectCtx ) {

						o._refreshError(rejectCtx.error);

						if( rejectCtx.next ) {

							rejectCtx.next();
						}
					});
				}
			};

			if( null !== o._config.onRefresh ) {

				var
				context = {};

				o._config.onRefresh( context, cb );

			} else {

				var
				xhr = o._ajax( o._config.refreshEndpoint, o._config.refreshParams, o._config.refreshHeaders, o._config.refreshData, cb );

				o._xhrs[ xhrID ] = xhr;
			}
		}

		,_refreshError
		: function( err ) {

			var
			o = this;

			o._debug('refresh error', err);

			if( o._refreshTimeout ) {

				clearTimeout( o._refreshTimeout);

				o._refreshTimeout = null;
			}

			var
			interval = o._config.refreshInterval + Math.round( Math.random() * 1000 );

			o._refreshTimeout = setTimeout( function() {

				return o._refresh();
			}, interval);
		}

		,_refreshResponse
		: function( result ) {

			var
			o = this;

			if( o._refreshTimeout ) {

				clearTimeout( o._refreshTimeout );

				o._refreshTimeout = null;
			}

			if( result.expires ) {

				o._clientID = result.client;

				o._refreshTimeout = setTimeout( function() {

					return o._refresh();

				}, o._getTTLMilliseconds(result.ttl));
			}
		}

		,_newXHRID
		: function() {

			this._xhrID++;
			return this._xhrID;
		}

		,_subRefresh
		: function( channel ) {

			var
			o = this;

			o._debug('refresh subscription token for channel', channel);

			if( undefined !== o._subRefreshTimeouts[ channel ] ) {

				o._clearSubRefreshTimeout( channel );
			} else {

				return;
			}

			var clientID = o._clientID;
			var xhrID = o._newXHRID();

			var cb = function cb(resp ) {

				if( xhrID in o._xhrs ) {

					delete o._xhrs[ xhrID ];
				}

				if( resp.error || resp.status !== 200 || o._clientID !== clientID ) {

					return;
				}

				var
				channelsData = {};

				if( resp.data.channels ) {

					for( var i in resp.data.channels ) {

						var
						channelData = resp.data.channels[ i ];

						if( !channelData.channel ) {

							continue;
						}

						channelsData[channelData.channel] = channelData.token;
					}
				}

				var
				token = channelsData[ channel ];

				if( !token ) {
					return;
				}

				var
				msg = {
					method: o._methodType.SUB_REFRESH,
					params: {
						channel: channel,
						token: token
					}
				};

				var
				sub = o._getSub( channel );

				if( null === sub ) {

					return;
				}

				o._call( msg ).then( function( resolveCtx ) {

					o._subRefreshResponse(channel, o._decoder.decodeCommandResult( o._methodType.SUB_REFRESH, resolveCtx.result ));

					if( resolveCtx.next ) {

						resolveCtx.next();
					}

				}, function( rejectCtx ) {

					o._subRefreshError( channel, rejectCtx.error );

					if( rejectCtx.next ) {

						rejectCtx.next();
					}
				});
			};

			var data = {
				client: o._clientID,
				channels: [ channel ]
			};

			if( null !== o._config.onPrivateSubscribe ) {

				o._config.onPrivateSubscribe({
					data: data
				}, cb);

			} else {

				var
				xhr = o._ajax( o._config.subscribeEndpoint, o._config.subscribeParams, o._config.subscribeHeaders, data, cb );
				o._xhrs[ xhrID ] = xhr;
			}
		}

		,_clearSubRefreshTimeout
		: function( channel ) {

			var
			o = this;

			if( undefined !== o._subRefreshTimeouts[ channel ] ) {

				clearTimeout( o._subRefreshTimeouts[ channel ] );

				delete o._subRefreshTimeouts[ channel ];
			}
		}

		,_subRefreshError
		: function( channel, err ) {

			var
			o = this;

			o._debug('subscription refresh error', channel, err );

			o._clearSubRefreshTimeout( channel );

			var sub = o._getSub( channel );

			if( null === sub ) {

				return;
			}

			var
			jitter = Math.round( Math.random() * 1000 ),
			subRefreshTimeout = setTimeout( function() {

				return o._subRefresh( channel );

			}, o._config.subRefreshInterval + jitter );

			o._subRefreshTimeouts[ channel ] = subRefreshTimeout;

			return;
		}

		,_subRefreshResponse
		: function( channel, result ) {

			var
			o = this;

			o._debug('subscription refresh success', channel );

			o._clearSubRefreshTimeout( channel );

			var
			sub = this._getSub( channel );

			if( null === sub ) {

				return;
			}

			if( true === result.expires ) {

				var
				subRefreshTimeout = setTimeout( function() {

					return o._subRefresh( channel );
				}, o._getTTLMilliseconds( result.ttl ) );

				o._subRefreshTimeouts[ channel ] = subRefreshTimeout;
			}

			return;
		}

		,_subscribe
		: function( sub, isResubscribe ) {

			var
			o = this,
			channel = sub.channel;

			o._debug('subscribing on', sub.channel );



			if( !(channel in o._subs) ) {

				o._subs[ channel ] = sub;
			}

			if( !o.isConnected() ) {
				// subscribe will be called later
				sub._setNew();
				return;
			}

			sub._setSubscribing( isResubscribe );

			var msg = {
				method: o._methodType.SUBSCRIBE,
				params: {
					channel: channel
				}
			};

			// If channel name does not start with privateChannelPrefix - then we
			// can just send subscription message to Centrifuge. If channel name
			// starts with privateChannelPrefix - then this is a private channel
			// and we should ask web application backend for permission first.
			if( startsWith( channel, o._config.privateChannelPrefix ) ) {
				// private channel.
				if( o._isSubscribeBatching ) {

					o._privateChannels[ channel ] = true;

				} else {

					o.startSubscribeBatching();
					o._subscribe(sub);
					o.stopSubscribeBatching();
				}
			} else {

				var
				recover = sub._needRecover();

				if( true === recover ) {

					msg.params.recover = true;

					var
					seq = o._getLastSeq( channel ),
					gen = o._getLastGen( channel );

					if( seq || gen ) {

						if( seq ) {

							msg.params.seq = seq;
						}

						if( gen ) {

							msg.params.gen = gen;
						}

					} else {

						var
						offset = o._getLastOffset( channel );

						if( offset ) {

							msg.params.offset = offset;
						}
					}

					var
					epoch = o._getLastEpoch( channel );

					if( epoch ) {
						msg.params.epoch = epoch;
					}
				}

				o._call( msg ).then( function( resolveCtx ) {

					o._subscribeResponse( channel, recover, o._decoder.decodeCommandResult( o._methodType.SUBSCRIBE, resolveCtx.result ));

					if( resolveCtx.next ) {

						resolveCtx.next();
					}

				}, function( rejectCtx ) {

					o._subscribeError( channel, rejectCtx.error );

					if( rejectCtx.next ) {

						rejectCtx.next();
					}
				});
			}
		}

		,_unsubscribe
		: function( sub ) {

			var
			o = this;

			delete o._subs[sub.channel];
			delete o._lastOffset[sub.channel];
			delete o._lastSeq[sub.channel];
			delete o._lastGen[sub.channel];

			if( o.isConnected() ) {
				// No need to unsubscribe in disconnected state - i.e. client already unsubscribed.
				o._addMessage({
					method: o._methodType.UNSUBSCRIBE,
					params: {
						channel: sub.channel
					}
				});
			}
		}

		,_getTTLMilliseconds
		: function( ttl ) {

			// https://stackoverflow.com/questions/12633405/what-is-the-maximum-delay-for-setinterval
			return Math.min( ttl * 1000, 2147483647 );
		}

		,getSub
		: function( channel ) {

			return this._getSub( channel );
		}

		,_getSub
		: function( channel ) {

			var
			sub = this._subs[ channel ];

			if( !sub ) {

				return null;
			}

			return sub;
		}

		,_isServerSub
		: function( channel ) {

			return undefined !== this._serverSubs[ channel ];
		}

		,_connectResponse
		: function( result, isRecover ) {

			var
			o = this,
			wasReconnecting = o._reconnecting;

			o._reconnecting = false;
			o._resetRetry();
			o._refreshRequired = false;

			if( o.isConnected() ) {

				return;
			}

			if( null !== o._latencyStart  ) {
				o._latency = new Date().getTime() - o._latencyStart.getTime();
				o._latencyStart = null;
			}

			o._clientID = result.client;
			o._setStatus('connected');

			if( o._refreshTimeout ) {
				clearTimeout( o._refreshTimeout);
			}

			if( result.expires ) {

				o._refreshTimeout = setTimeout( function() {

					return o._refresh();

				}, o._getTTLMilliseconds( result.ttl ) );
			}

			o.startBatching();
			o.startSubscribeBatching();

			for( var channel in o._subs ) {

				if( o._subs.hasOwnProperty( channel ) ) {

					var
					sub = o._subs[ channel ];

					if( sub._shouldResubscribe() ) {

						o._subscribe( sub, wasReconnecting );
					}
				}
			}

			o.stopSubscribeBatching();
			o.stopBatching();

			o._startPing();

			var
			ctx = {
				client: result.client,
				transport: o._transportName,
				latency: o._latency
			};

			if( result.data ) {

				ctx.data = result.data;
			}

			o.emit('connect', ctx);

			if( result.subs ) {
				o._processServerSubs( result.subs, isRecover );
			}
		}

		,_processServerSubs
		: function( subs, isRecover ) {

			var
			o = this;

			for( var channel in subs ) {

				if( subs.hasOwnProperty( channel ) ) {

					var
					sub = subs[ channel ],
					recovered = true === sub.recovered,
					subCtx = { channel: channel, isResubscribe: isRecover, recovered: recovered };

					o.emit('subscribe', subCtx);
				}
			}

			for( var channel in subs ) {

				if( subs.hasOwnProperty( channel ) ) {

					var
					sub = subs[ channel ];
					if( sub.recovered ) {
						var pubs = sub.publications;
						if( pubs && pubs.length > 0 ) {

							// handle legacy order.
							// TODO: remove as soon as Centrifuge v1 released.
							if( pubs.length > 1 && (!pubs[ 0 ].offset || pubs[ 0 ].offset > pubs[ 1 ].offset) ) {
								pubs = pubs.reverse();
							}

							for( var i in pubs ) {

								if( pubs.hasOwnProperty( i ) ) {

									o._handlePublication( channel, pubs[ i ] );
								}
							}
						}
					}

					o._serverSubs[ channel ] = {
						'seq': sub.seq,
						'gen': sub.gen,
						'offset': sub.offset,
						'epoch': sub.epoch,
						'recoverable': sub.recoverable
					};
				}
			}
		}

		,_stopPing
		: function() {

			var
			o = this;

			if( null !== o._pongTimeout ) {

				clearTimeout( o._pongTimeout );
				o._pongTimeout = null;
			}

			if( null !== o._pingTimeout ) {

				clearTimeout(o._pingTimeout);
				o._pingTimeout = null;
			}
		}

		,_startPing
		: function() {

			var
			o = this;

			if( o._config.ping !== true || o._config.pingInterval <= 0 ) {

				return;
			}

			if( !o.isConnected() ) {

				return;
			}

			o._pingTimeout = setTimeout( function() {

				if( !o.isConnected() ) {

					o._stopPing();

					return;
				}

				o.ping();

				o._pongTimeout = setTimeout( function() {

					o._disconnect('no ping', true);

				}, o._config.pongWaitTimeout);

			}, o._config.pingInterval);
		}

		,_restartPing
		: function() {

			this._stopPing();
			this._startPing();
		}

		,_subscribeError
		: function( channel, error ) {

			var
			sub = this._getSub( channel );

			if( !sub ) {

				return;
			}

			if( !sub._isSubscribing() ) {
				return;
			}

			if( 0 === error.code && _errorTimeout === error.message ) {
				// client side timeout.
				this._disconnect('timeout', true );

				return;
			}

			sub._setSubscribeError( error );
		}

		,_subscribeResponse
		: function( channel, isRecover, result ) {

			var
			o = this;

			var
			sub = o._getSub( channel );

			if( !sub ) {

				return;
			}

			if( !sub._isSubscribing() ) {

				return;
			}

			var
			recovered = false;

			if('recovered' in result ) {

				recovered = result.recovered;
			}

			sub._setSubscribeSuccess(recovered);

			var
			pubs = result.publications;

			if( pubs && pubs.length > 0 ) {

				if( pubs.length >= 2 && !pubs[ 0 ].offset && !pubs[ 1 ].offset ) {
					// handle legacy order.
					pubs = pubs.reverse();
				}

				for( var i in pubs ) {

					if( pubs.hasOwnProperty( i ) ) {

						o._handlePublication( channel, pubs[ i ] );
					}
				}
			}

			if( result.recoverable && (!isRecover || !recovered) ) {

				o._lastSeq[ channel ] = result.seq || 0;
				o._lastGen[ channel ] = result.gen || 0;
				o._lastOffset[ channel ] = result.offset || 0;
			}

			o._lastEpoch[ channel ] = result.epoch || '';

			if( result.recoverable ) {

				sub._recoverable = true;
			}

			if( result.expires === true ) {

				var
				subRefreshTimeout = setTimeout( function() {

					return o._subRefresh( channel );

				}, o._getTTLMilliseconds( result.ttl ) );

				o._subRefreshTimeouts[ channel ] = subRefreshTimeout;
			}
		}

		,_handleReply
		: function( reply, next ) {

			var
			o = this,
			id = reply.id,
			result = reply.result;

			if( !( id in this._callbacks ) ) {

				next();

				return;
			}

			var
			callbacks = o._callbacks[ id ];

			clearTimeout( o._callbacks[ id ].timeout);

			delete o._callbacks[ id ];

			if( !errorExists( reply ) ) {

				var
				callback = callbacks.callback;

				if( !callback ) {

					return;
				}

				callback({ result: result, next: next });

			} else {

				var
				errback = callbacks.errback;

				if( !errback ) {

					next();

					return;
				}

				var
				error = reply.error;
				errback({ error: error, next: next });
			}
		}

		,_handleJoin
		: function( channel, join ) {

			var
			o = this,
			ctx = { 'info': join.info },
			sub = o._getSub( channel );

			if( !sub ) {

				if( o._isServerSub( channel ) ) {

					ctx.channel = channel;
					o.emit('join', ctx);
				}

				return;
			}

			sub.emit('join', ctx);
		}

		,_handleLeave
		: function( channel, leave ) {

			var
			o = this,
			ctx = { 'info': leave.info },
			sub = o._getSub( channel );

			if( !sub ) {

				if( o._isServerSub( channel ) ) {

					ctx.channel = channel;
					o.emit('leave', ctx);
				}

				return;
			}

			sub.emit('leave', ctx);
		}

		,_handleUnsub
		: function( channel, unsub ) {

			var
			o = this,
			ctx = {},
			sub = o._getSub( channel );

			if( !sub ) {

				if( o._isServerSub( channel ) ) {

					delete o._serverSubs[ channel ];

					ctx.channel = channel;
					o.emit('unsubscribe', ctx);
				}

				return;
			}

			sub.unsubscribe();

			if( true === unsub.resubscribe ) {

				sub.subscribe();
			}
		}

		,_handleSub
		: function( channel, sub ) {

			var
			o = this,
			ctx = { 'channel': channel, isResubscribe: false, recovered: false };

			o._serverSubs[ channel ] = {
				'seq'		: sub.seq,
				'gen'		: sub.gen,
				'offset'	: sub.offset,
				'epoch'		: sub.epoch,
				'recoverable'	: sub.recoverable
			};
			
			o.emit('subscribe', ctx);
		}

		,_handlePublication
		: function( channel, pub ) {

			var
			o = this,
			sub = o._getSub( channel ),
			ctx = {
				'data'		: pub.data,
				'seq'		: pub.seq,
				'gen'		: pub.gen,
				'offset'	: pub.offset
			};

			if( pub.info ) {

				ctx.info = pub.info;
			}

			if( !sub ) {

				if( o._isServerSub( channel ) ) {

					if( undefined !== pub.seq ) {

						o._serverSubs[ channel ].seq = pub.seq;
					}

					if( undefined !== pub.gen ) {

						o._serverSubs[ channel ].gen = pub.gen;
					}

					if( undefined !== pub.offset ) {

						o._serverSubs[ channel ].offset = pub.offset;
					}

					ctx.channel = channel;
					o.emit('publish', ctx);
				}

				return;
			}

			if( undefined !== pub.seq ) {

				o._lastSeq[ channel ] = pub.seq;
			}

			if( undefined !== pub.gen ) {

				o._lastGen[ channel ] = pub.gen;
			}

			if( undefined !== pub.offset ) {

				o._lastOffset[ channel ] = pub.offset;
			}

			sub.emit('publish', ctx );
		}

		,_handleMessage
		: function( message ) {

			this.emit('message', message.data);
		}

		,_handlePush
		: function( data, next ) {

			var
			o = this,
			push = o._decoder.decodePush( data ),
			type = 0;

			if('type' in push ) {

				type = push['type'];
			}

			var
			channel = push.channel;

			if( type === o._pushType.PUBLICATION ) {

				var
				pub = o._decoder.decodePushData( o._pushType.PUBLICATION, push.data );

				o._handlePublication( channel, pub );

			} else if( type === o._pushType.MESSAGE ) {

				var
				message = o._decoder.decodePushData( o._pushType.MESSAGE, push.data );

				o._handleMessage( message );

			} else if( type === o._pushType.JOIN ) {

				var
				join = o._decoder.decodePushData( o._pushType.JOIN, push.data );

				o._handleJoin( channel, join );

			} else if( type === o._pushType.LEAVE ) {

				var
				leave = o._decoder.decodePushData( o._pushType.LEAVE, push.data );

				o._handleLeave( channel, leave );

			} else if( type === o._pushType.UNSUB ) {

				var
				unsub = o._decoder.decodePushData( o._pushType.UNSUB, push.data );

				o._handleUnsub( channel, unsub );

			} else if( type === o._pushType.SUB ) {

				var
				sub = o._decoder.decodePushData( o._pushType.SUB, push.data );
	
				o._handleSub( channel, sub );
			}

			next();
		}

		,_flush
		: function() {

			var
			o = this,
			messages = o._messages.slice( 0 );

			o._messages = [];
			o._transportSend( messages );
		}

		,_ping
		: function() {

			var
			o = this,
			msg = {
				method: o._methodType.PING
			};

			o._call( msg ).then(function( resolveCtx ) {
				o._pingResponse( o._decoder.decodeCommandResult( o._methodType.PING, resolveCtx.result ) );

				if( resolveCtx.next ) {

					resolveCtx.next();
				}

			}, function( rejectCtx ) {

				o._debug('ping error', rejectCtx.error );

				if( rejectCtx.next ) {

					rejectCtx.next();
				}
			});
		}

		,_pingResponse
		: function( result ) {

			var
			o = this;

			if( !o.isConnected() ) {

				return;
			}

			o._stopPing();
			o._startPing();
		}

		,_getLastSeq
		: function( channel ) {

			var
			lastSeq = this._lastSeq[ channel ];

			if( lastSeq ) {

				return lastSeq;
			}

			return 0;
		}

		,_getLastOffset
		: function( channel ) {

			var
			lastOffset = this._lastOffset[ channel ];

			if( lastOffset ) {

				return lastOffset;
			}

			return 0;
		}

		,_getLastGen
		: function( channel ) {

			var
			lastGen = this._lastGen[ channel ];

			if( lastGen ) {

				return lastGen;
			}

			return 0;
		}

		,_getLastEpoch
		: function( channel ) {

			var
			lastEpoch = this._lastEpoch[ channel ];

			if( lastEpoch ) {

				return lastEpoch;
			}

			return '';
		}

		,_createErrorObject
		: function( message, code ) {

			var
			errObject = {
				message: message,
				code: code || 0
			};

			return errObject;
		}

		,_registerCall
		: function( id, callback, errback ) {

			var
			o = this;

			o._callbacks[ id ] = {
				callback: callback,
				errback: errback,
				timeout: null
			};

			o._callbacks[ id ].timeout = setTimeout( function() {

				delete o._callbacks[ id ];

				if( isFunction( errback ) ) {

					errback({ error: o._createErrorObject(_errorTimeout) });
				}

			}, o._config.timeout);
		}

		,_addMessage
		: function( message ) {

			var
			o = this,
			id = o._nextMessageId();

			message.id = id;

			if( true === o._isBatching ) {

				o._messages.push( message );

			} else {

				o._transportSend([message]);
			}

			return id;
		}

		,isConnected
		: function() {

			return this._isConnected();
		}

		,connect
		: function() {

			this._connect();
		}

		,disconnect
		: function() {

			this._disconnect('client', false);
		}

		,ping
		: function() {

			return this._ping();
		}

		,startBatching
		: function() {

			// start collecting messages without sending them to Centrifuge until flush
			// method called
			this._isBatching = true;
		}

		,stopBatching
		: function() {

			this._isBatching = false;
			this._flush();
		}

		,startSubscribeBatching
		: function() {

			// start collecting private channels to create bulk authentication
			// request to subscribeEndpoint when stopSubscribeBatching will be called
			this._isSubscribeBatching = true;
		}

		,stopSubscribeBatching
		: function() {

			var
			o = this,
			authChannels = o._privateChannels,
			channels = [];

			// create request to subscribeEndpoint with collected private channels
			// to ask if this client can subscribe on each channel
			o._isSubscribeBatching = false;
			o._privateChannels = {};

			for( var channel in authChannels ) {

				if( authChannels.hasOwnProperty( channel ) ) {

					var
					sub = o._getSub( channel );

					if( !sub ) {

						continue;
					}

					channels.push( channel );
				}
			}

			if( 0 === channels.length ) {

				o._debug('no private channels found, no need to make request');

				return;
			}

			var
			data = {

				client: o._clientID,
				channels: channels
			},

			clientID = o._clientID,
			xhrID = o._newXHRID(),

			cb = function cb( resp ) {

				if( xhrID in o._xhrs ) {

					delete o._xhrs[ xhrID ];
				}

				if( o._clientID !== clientID ) {

					return;
				}

				if( resp.error || 200 !== resp.status ) {

					o._debug('authorization request failed');

					for( var i in channels ) {

						if( channels.hasOwnProperty( i ) ) {

							var
							channel = channels[ i ];

							o._subscribeError( channel, o._createErrorObject('authorization request failed') );
						}
					}

					return;
				}

				var
				channelsData = {};

				if( resp.data.channels ) {

					for( var i in resp.data.channels ) {

						var
						channelData = resp.data.channels[ i ];

						if( !channelData.channel ) {

							continue;
						}

						channelsData[ channelData.channel ] = channelData.token;
					}
				}

				// try to send all subscriptions in one request.
				var
				batch = false;

				if( !o._isBatching ) {

					o.startBatching();
					batch = true;
				}

				for( var i in channels ) {

					if( channels.hasOwnProperty( i ) ) {

						var
						_ret2 = function() {

							var
							channel = channels[ i ],
							token = channelsData[ channel ];

							if( !token ) {
								// subscription:error
								o._subscribeError( channel, o._createErrorObject('permission denied', 103 ) );

								return 'continue';
							} else {

								var
								msg = {
									method: o._methodType.SUBSCRIBE,
									params: {
										channel: channel,
										token: token
									}
								};

								var
								sub = o._getSub( channel );

								if( null === sub ) {

									return 'continue';
								}

								var
								recover = sub._needRecover();

								if( recover === true ) {

									msg.params.recover = true;

									var
									seq = o._getLastSeq( channel ),
									gen = o._getLastGen( channel );

									if( seq || gen ) {

										if( seq ) {

											msg.params.seq = seq;
										}

										if( gen ) {

											msg.params.gen = gen;
										}
									} else {

										var
										offset = o._getLastOffset( channel );

										if( offset ) {
											msg.params.offset = offset;
										}
									}

									var
									epoch = o._getLastEpoch( channel );

									if( epoch ) {
										msg.params.epoch = epoch;
									}
								}
								o._call( msg ).then( function( resolveCtx ) {

									o._subscribeResponse( channel, recover,  o._decoder.decodeCommandResult( o._methodType.SUBSCRIBE, resolveCtx.result ) );

									if( resolveCtx.next ) {

										resolveCtx.next();
									}

								}, function( rejectCtx ) {

									o._subscribeError( channel, rejectCtx.error );

									if( rejectCtx.next ) {

										rejectCtx.next();
									}
								});
							}
						}();

						if('continue' === _ret2 ) continue;
					}
				}

				if( batch ) {

					o.stopBatching();
				}
			};

			if( null !== o._config.onPrivateSubscribe ) {

				o._config.onPrivateSubscribe({
					data: data
				}, cb);

			} else {

				var
				xhr = o._ajax( o._config.subscribeEndpoint, o._config.subscribeParams, o._config.subscribeHeaders, data, cb );

				o._xhrs[ xhrID ] = xhr;
			}
		}

		,subscribe
		: function( channel, events ) {

			var
			o = this,
			currentSub = o._getSub( channel );

			if( null !== currentSub ) {

				currentSub._setEvents( events );

				if( currentSub._isUnsubscribed() ) {

					currentSub.subscribe();
				}

				return currentSub;
			}

			var
			sub = new Subscription( o, channel, events );

			o._subs[ channel ] = sub;

			sub.subscribe();

			return sub;
		}
	};


	return new Centrifuge();
}
