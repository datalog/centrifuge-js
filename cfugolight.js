/**
	https://github.com/datalog/centrifuge-js
	under MIT license
	# cfugolight.js has no dependencies
	Copyright (c) 2020 Constantine
*/

/**
	Sometimes, the best tool is absence of tool.
*/
/**
	Centrifuge API:
	CONNECT		:  0
	SUBSCRIBE	:  1
	UNSUBSCRIBE	:  2
	PUBLISH		:  3
	PRESENCE	:  4
	PRESENCE_STATS	:  5
	HISTORY		:  6
	PING		:  7
	SEND		:  8
	RPC		:  9
	REFRESH		: 10
	SUB_REFRESH	: 11
*/

'use strict';

var
 url = 'ws://centrifuge.example.com/connection/websocket'
,cnl = 'news' /* <-- channel name */
,tkn = '[[[TOKEN]]]' /* <-- should be issued by server */
;

___cfupdate();

function ___parsejsondata( d ) {

	try {

		return JSON.parse( d );

	} catch( e ) {}

	return {};
};

function ___decodedata( data ) {

	var
	msgs = [];

	data.split('\n').forEach( function( d ) {

		if( d ) {

			msgs.push( ___parsejsondata( d ) );
		}
	} );

	return msgs;
}

function ___cfupdate( attempt ) {

	var
	ws = new WebSocket( url ),

	maxdelay = 25,
	attempt = ( attempt ) ? attempt : 1,

	_msgcounter = 0,
	_revive = 1;

	function ecc( error ) {

		var
		err = error.code,
		msg = error.message,

		actions = {

			109 : function() {

				console.log('wsocket error [ ' + msg + ' ]');

				_revive = 0;
				ws.close();

				return false;
			}
		};

		return actions[ err ] ? actions[ err ]() : false;
	}

	function wspush( msg ) {

		msg.id = ++_msgcounter;
		ws.send( JSON.stringify( msg ) );
	};

	ws.onclose = function( e ) {

		console.log('wsocked was closed [ ' + e.code + ' ]');

		var
		reconnect = ___parsejsondata( e.reason ).reconnect;

		if( _revive || reconnect ) {

			setTimeout( function() {

				___cfupdate( ++attempt );

			}, !reconnect * (( attempt > maxdelay ) ? maxdelay : attempt ) * 1000 );
		}
	};

	ws.onerror = function() {

		_revive = 1;
	};

	ws.onopen = function() {

		attempt = 0;

		wspush( {
				 params : {

					token : tkn
				 }
			  	/** method : 0 */
		} );
	};

	ws.onmessage = function( e ) {

		/** CAUTION! We can receive more than one line */
		___decodedata( e.data ).forEach( function( msg ) {

			var
			error = msg.error || 0,

			result = msg.result || {},
			client = result.client,
			data = result.data;


			if( error ) {

				/** error code and explanation comes as a last cry with json */
				return ecc( error );
			}

			if( client ) {

				wspush( {


					 params : {

						channel : cnl
					 }
					,method : 1
				} );

			} else

			if( data ) {

				/* MESSAGE FROM CFSERVER RECEIVED */
				console.log( data );
			}
		} );
	};
}
