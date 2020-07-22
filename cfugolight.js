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
 tk = '[[[TOKEN]]]' /* <-- should be issued by server */
,cn = 'news' /* <-- channel name */
,ws = new WebSocket('ws://centrifuge.example.com/connection/websocket');

ws._msgcounter = 0;

function wspush( msg ) {

	msg.id = ++ws._msgcounter;
	ws.send( JSON.stringify( msg ) );
};

ws.onopen = function() {

	wspush( {

			 params : {

				token : tk
			}
			/*,method :  0 */
	} );
};

ws.onmessage = function( ev ) {

	var
	msg = {};

	try {
		msg = JSON.parse( ev.data || {} );

	} catch( e ) {}

	var
	result = msg.result || {},
	client = result.client,
	data = result.data;

	if( client ) {

		wspush( {

			 params : {

				channel : cn
			}
			,method : 1
		} );

	} else

	if( data ) {

		/* MESSAGE FROM SERVER RECEIVED */
	}
};
