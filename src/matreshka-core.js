"use strict";
(function (root, factory) {
    if (typeof define == 'function' && define.amd) {
        define([
			'xclass',
			'balalaika',
			'matreshka_dir/dollar-lib',
			'matreshka_dir/binders'
		], factory);
    } else {
        root.MK = root.Matreshka = factory( root.Class, root.$b, root.__DOLLAR_LIB, root.__MK_BINDERS );
    }
}(this, function ( Class, $b, $, binders ) {

if( !Class ) {
	throw Error( 'Class function is missing' );
}
if( ![].forEach ) {
	throw Error( 'Internet Explorer 8 requires to use es5-shim: https://github.com/es-shims/es5-shim' );
}
/**
 * @private
 * @since 0.0.4
 * @todo optimize
 * @summary This object is used to map DOM nodes and their DOM events
 */
var domEventsMap = {
	list: {},
	// adds events to the map
	add: function( o ) {
		if( o.node ) {
			if( typeof o.on == 'function' ) {
				o.on.call( o.node, o.handler );
			} else {
				$( o.node ).on( o.on.split( /\s/ ).join( '.mk ' ) + '.mk', o.handler );
			}
		}
		
		( this.list[ o.instance.__id ] = this.list[ o.instance.__id ] || [] ).push( o );
	},
	// removes events from the map
	remove: function( o ) {
		var evts = this.list[ o.instance.__id ],
			evt, i;
			
		if( !evts ) return;
  
		for( i = 0; i < evts.length; i++ ) {
			evt = evts[ i ];
			if( evt.node !== o.node ) continue;
			// remove Matreshka event
			evt.mkHandler && o.instance._off( '_runbindings:' + o.key, evt.mkHandler );
			// remove DOM event
			$( o.node ).off( evt.on + '.mk', evt.handler );
			this.list[ o.instance.__id ].splice( i--, 1 );
		}
	}
},
slice = [].slice,
trim = function( s ) { return s.trim ? s.trim() : s.replace(/^\s+|\s+$/g, '') },
/**
 * @private
 * @summary selectNodes selects nodes match to custom selectors such as :sandbox and :bound(KEY)
 */
selectNodes = function( _this, s ) {
	var result = $(),
		execResult,
		bound,
		selector;
	
	// replacing :sandbox to :bound(sandbox)
	s.replace( /:sandbox/g, ':bound(sandbox)' ).split( ',' ).forEach( function( s ) {
		// if selector contains ":bound(KEY)" substring
		if( execResult = /:bound\(([^(]*)\)(.*)/.exec( trim(s) ) ) {
			// getting KEY from :bound(KEY)
			bound = _this.$bound( execResult[1] );
			
			// if native selector passed after :bound(KEY) is not empty string
			// for example ":bound(KEY) .my-selector"
			if( selector = trim( execResult[2] ) ) {
				// if native selector contains children selector
				// for example ":bound(KEY) > .my-selector"
				if( selector.indexOf( '>' ) == 0 ) {
					// selecting children
					each( bound, function( node ) {
						var r = MK.randomString();
						node.setAttribute( r, r );
						result = result.add( $( '['+r+'="'+r+'"]' + selector, node ) );
						node.removeAttribute( r );
					});
				} else {
					// if native selector doesn't contain children selector
					result = result.add( bound.find( selector ) );
				}
			} else {
				// if native selector is empty string
				result = result.add( bound );
			}
		// if it's native selector
		} else {
			result = result.add( s );
		}
	});
		
	return result;
};


var MK = Class({
	//__special: null, // { <key>: { getter: f, $nodes: jQ, value: 4 }}
	//__events: null,
	isMK: true,
	/**
	 * @private
	 * @member {boolean} Matreshka#isMKInitialized
	 * @summary Using for lazy initialization
	 */
	isMKInitialized: false,
	
	on: function( names, callback, triggerOnInit, context, xtra ) {
		var _this = this._initMK(),
			t, i;
		
		// if event-callback object is passed to the function
		if( typeof names == 'object' && !(names instanceof Array) ) {
			for( i in names ) if( names.hasOwnProperty( i ) ) {
				_this.on( i, names[ i ], callback, triggerOnInit );
			}
			
			return _this;
		}
		
		// callback is required
		if( !callback ) throw Error( 'callback is not function for event(s) "'+names+'"' );
			
		names = names instanceof Array ? names : trim( names )
			.replace( /\s+/g, ' ' ) // single spaces only
			.split( /\s(?![^(]*\))/g ) // split by spaces
		;
		
		// allow to flip triggerOnInit and context
		if( typeof triggerOnInit != 'boolean' && typeof triggerOnInit != 'undefined' ) {
			t = context;
			context = triggerOnInit;
			triggerOnInit = t;
		}
		
		// for every name call _on method
		for( i = 0; i < names.length; i++ ) {
			_this._on( names[ i ], callback, context, xtra );
		}
		
		// trigger after event is initialized
		if( triggerOnInit === true ) {
			callback.call( context || _this, {
				triggeredOnInit: true
			});
		}
		
		return _this;
	},
	onDebounce: function( names, callback, debounceDelay, triggerOnInit, context, xtra ) {
		var cbc;
		// flip args
		if( typeof debounceDelay != 'number' ) {
			xtra = context;
			context = triggerOnInit;
			triggerOnInit = debounceDelay;
			debounceDelay = 0;
		};
		
		cbc = MK.debounce( callback, debounceDelay );
		
		// set reference to real callback for .off method
		cbc._callback = callback;
		
		return this.on( names, cbc, triggerOnInit, context, xtra );
	},
	// @TODO refactor
	_on: function( name, callback, context, xtra ) {
		// index of @
		var indexOfET = name.indexOf( '@' ),
			_this = this._initMK(),
			ctx = context || _this,
			delegatedReg = /^(.*?)\((.*)\)/,
			evtName,
			selector,
			key_selector,
			events,
			ev,
			key,
			changeHandler, bindHandler, unbindHandler,
			domEvtHandler, tmp, domEvtName;
		
		// if @ exists in event name
		if( ~indexOfET ) {
			// a@b -> key=a name=b
			key = name.slice( 0, indexOfET );
			name = name.slice( indexOfET + 1 );
			// called when value of delegated property is changed
			changeHandler = function( evt ) {
				var target = _this[ key ],
					handler;
					
				// if new value is Matreshka instance
				if( target && target.isMK ) {
					handler = function( evt ) {
						if( !evt || !evt.private ) {
							callback.apply( this, arguments );
						}
					};
					
					handler._callback = callback;
					
					// add event to the new value
					target._on( name, handler, ctx );
				}
				
				// remove event handler from previous value 
				if( evt && evt.previousValue && evt.previousValue.isMK ) {
					evt.previousValue._off( name, callback, context );
				}
			};
			changeHandler._callback = callback;
			_this._on( 'change:' + key, changeHandler, _this, name );
			changeHandler();
		// if @ doesn't exist in event name
		} else {
			// x::(y) -> x::sandbox(y)
			name = name.replace( '::(', '::sandbox(' );
			// x::a(b) -> x::a
			evtName = name.replace( /\(.+\)/, '' );
			// event magic from Backbone
			events = _this.__events[ evtName ] || (_this.__events[ evtName ] = []);
			ev = {
				callback: callback,
				context: context,
				ctx: ctx,
				xtra: xtra
			};
			
			// if there is no event with same callback
			if( !events.some( function( ev2 ) {
				return ev2.callback == ev.callback && ev2.callback._callback == ev.callback && ev2.context == ev.context;
			}) ) {
				
				// add given event object to an array of events
				events.push( ev );
				
				// if event name is change:KEY
				if( !name.indexOf( 'change:' ) ) {
					// define needed accessors for KEY
					_this._defineSpecial( name.replace( 'change:', '' ) );
				}
				
				
				// x::y -> domEvtName = x, key = y
				tmp = name.split( '::' );
				domEvtName = tmp[ 0 ];
				key = tmp[ 1 ];
				
				// if event name is DOM_EVT::KEY (eg click::x)
				if( key ) {
					// retrieve selector from event name
					
					if( key_selector = delegatedReg.exec( key ) ) {
						// x::y(z) -> z
						selector = ev.selector = key_selector[2];
						// x::y(z) -> y
						key = key_selector[1];
					}
					
					domEvtHandler = function( evt ) {
						var node = this,
							$nodes = $( node ),
							handler = function() {
								// add often used properties to event object
								callback.call( ctx, {
									self: _this,
									node: node,
									$nodes: $nodes,
									key: key,
									domEvent: evt,
									originalEvent: evt.originalEvent || evt,
									preventDefault: function() {
										evt.preventDefault();
									},
									stopPropagation: function() {
										evt.stopPropagation();
									},
									which: evt.which,
									target: evt.target
								});
							},
							is, randomID;
							
						// DOM event is delegated
						if( selector ) {
							randomID = 'x' + String( Math.random() ).split( '.' )[1];
							node.setAttribute( randomID, randomID );
							is = '['+randomID+'="'+randomID+'"] ' + selector;
							if( $( evt.target ).is( is + ',' + is + ' *' ) ) {
								handler();
							}
							node.removeAttribute( randomID );
						} else {
							handler();
						}
					};
					bindHandler = function( evt ) {
						var $nodes = evt && evt.$nodes || _this.__special[ key ] && _this.__special[ key ].$nodes,
							evtName = domEvtName + '.' + _this.__id + key;
							
						$nodes && $nodes.on( evtName, domEvtHandler );
					},
					unbindHandler = function( evt ) {
						evt.$nodes && evt.$nodes.off( domEvtName + '.' + _this.__id + key, domEvtHandler );
					};
					
					bindHandler._callback = unbindHandler._callback = callback;
					
					_this._on( 'bind:' + key, bindHandler );
					bindHandler();
					_this._on( 'unbind:' + key, unbindHandler );
				}
			}
		}
		return _this;
	},
	
	
	once: function ( names, callback, context ) {
		if( !callback ) throw Error( 'callback is not function for event "'+names+'"' );
		var _this = this._initMK(),
			i;
			
		names = names.split( /\s/ );
		
		for( i = 0; i < names.length; i++ ) {
			( function( name ) {
				var once = ( function(func) {
					var ran = false, memo;
					return function() {
						if (ran) return memo;
						ran = true;
						memo = func.apply(this, arguments);
						func = null;
						return memo;
					};
				})( callback );
				once._callback = callback;
				_this._on( name, once, context ) ;
			})( names[ i ] );
		}
		
		return this;
	},
	
	
	
	off: function( names, callback, context ) {
		var _this = this._initMK(),
			i;
		
		// if event-callback object is passed to the function
		if( typeof names == 'object' && !(names instanceof Array) ) {
			for( i in names ) if( names.hasOwnProperty( i ) ) {
				_this.off( i, names[ i ], callback );
			}
			
			return _this;
		}
		
		if (!names && !callback && !context) {
			_this.events = {};
			return _this;
		}
		
		names = trim( names )
			.replace( /\s+/g, ' ' ) // single spaces only
			.split( /\s(?![^(]*\))/g )
		;
		
		for (i = 0; i < names.length; i++) {
			_this._off(names[ i ], callback, context);
		}
		
		return _this;
	},
  
	_off: function( name, callback, context ) {
		var indexOfET = name.indexOf( '@' ),
			_this = this._initMK(),
			delegatedReg = /^(.*?)\((.*)\)/,
			selector,
			key_selector,
			retain, ev, events, key, domEvt, domEvtName, domEvtKey, i;
		if( ~indexOfET ) {
			key = name.slice( 0, indexOfET );
			name = name.slice( indexOfET + 1 );
			
			if( callback ) {
				_this._off( 'change:' + key, callback, context );
			} else {
				events = _this.__events[ 'change:' + key ] || [];
				for( i = 0; i < events.length; i++ ) {
					if( events[ i ].xtra === name ) {
						_this._off( 'change:' + key, events[ i ].callback );
					}
				}
			}
			
			if( _this[ key ] && _this[ key ].isMK ) {
				_this[ key ]._off( name, callback, context );
			}
			
		} else if (events = _this.__events[name]) {
			_this.__events[name] = retain = [];
			if (callback || context) {
				for ( i = 0; i < events.length; i++) {
					ev = events[i];
					
					if ((callback && callback !== ev.callback && callback !== ev.callback._callback) || (context && context !== ev.context)) {
						retain.push(ev);
					}
				}
			}
			if (!retain.length) delete _this.__events[name];
			
			domEvt = name.split( '::' );
			domEvtName = domEvt[ 0 ];
			key = domEvt[ 1 ]; 
			if( key && _this.__special[ key ] ) {
				if( key_selector = delegatedReg.exec( key ) ) {
					selector = ev.selector = key_selector[2];
					key = key_selector[1];
				}
				
				_this.__special[ key ].$nodes.off( domEvtName + '.' + _this.__id + key );
				
				_this._off( 'bind:' + key, callback );
				_this._off( 'unbind:' + key, callback );
			}
		}
		
		return _this;
	},
	
	
	trigger: function(names) {
		var _this = this._initMK(),
			args,
			i;
			
		if( names ) {
			args = slice.call(arguments);
			names = names.split( /\s/ );
			
			for( i = 0; i < names.length; i++ ) {
				args = args.slice();
				args[ 0 ] = names[ i ];
				_this._trigger.apply( _this, args );
			}
		}
		
		return _this;
	},
	
	_trigger: function(name) {
		var _this = this._initMK(),
			events = _this.__events[name],
			args, triggerEvents;
		if( name && events ) {
			args = slice.call(arguments, 1),
			triggerEvents = function(events, args) {
				var ev, i = -1, l = events.length;
				while (++i < l) (ev = events[i]).callback.apply(ev.ctx, args || []);
			};
			
			triggerEvents(events, args);
		}
		return _this;
	},
	
	
	bindNode: function( key, node, binder, evt, optional ) {
		var _this = this._initMK(),
			isUndefined = typeof _this[ key ] == 'undefined',
			$nodes,
			keys,
			i,
			special;
		
		/*
		 * this.bindNode([['key', $(), {on:'evt'}], [{key: $(), {on: 'evt'}}]], { silent: true });
		 */
		if( key instanceof Array ) {
			for( i = 0; i < key.length; i++ ) {
				_this.bindNode( key[ i ][ 0 ], key[ i ][ 1 ], key[ i ][ 2 ] || evt, node );
			}
			
			return _this;
		}
		
		/*
		 * this.bindNode('key1 key2', node, binder, { silent: true });
		 */
		if( typeof key == 'string' ) {
			keys = key.split( /\s/ );
			if( keys.length > 1 ) {
				for( i = 0; i < keys.length; i++ ) {
					_this.bindNode( keys[ i ], node, binder, evt );
				}
				return _this;
			}
		}
		
		
		/*
		 * this.bindNode({ key: $() }, { on: 'evt' }, { silent: true });
		 */		
		if( typeof key == 'object' ) {
			for( i in key ) if( key.hasOwnProperty( i ) ) {
				_this.bindNode( i, key[ i ], node, binder, evt );
			}
			return _this;
		}
		
		evt = evt || {};
		
		special = _this._defineSpecial( key );
		
		$nodes = _this._getNodes( node );
		
		if( !$nodes.length ) {
			if( optional ) {
				return _this;
			} else {
				throw Error( 'Binding error: node is missing for key "'+key+'"' );
			}
		}
		
		

		special.$nodes = special.$nodes.add( $nodes );
		
		_this.$nodes[ key ] = special.$nodes;
		_this.nodes[ key ] = special.$nodes[ 0 ];
		
		if( key == 'sandbox' ) {
			_this.$sandbox = special.$nodes;
			_this.sandbox = special.$nodes[ 0 ];
		}
		
		MK.each( $nodes, function( node ) {
			var _binder = binder !== null ? extend( key == 'sandbox' ? {} : MK.lookForBinder( node ) || {}, binder ) : {},
				options = {
					self: _this,
					key: key,
					$nodes: $nodes,
					node: node
				},
				mkHandler;
			
			if( _binder.initialize ) {
				_binder.initialize.call( node, extend( { value: special.value }, options ) );
			}
			
			if( _binder.setValue ) {
				mkHandler = function( evt ) {
					var v = _this[ key ];
					if( evt && evt.changedNode == node && evt.onChangeValue == v ) return;
					_binder.setValue.call( node, v, extend( { value: v }, options ) );
				};
				_this._on( '_runbindings:' + key, mkHandler );
				!isUndefined && mkHandler()
			}
			
			if( isUndefined && _binder.getValue && evt.assignDefaultValue !== false ) {
				_this.set( key, _binder.getValue.call( node, options ), extend({
					fromNode: true
				}, evt ));
			}
			
			if( _binder.getValue && _binder.on ) {
				domEventsMap.add({
					node: node,
					on: _binder.on,
					instance: _this,
					key: key,
					mkHandler: mkHandler,
					handler: function( evt ) {
						var oldvalue = _this[ key ],
							value = _binder.getValue.call( node, extend({
								value: oldvalue,
								domEvent: evt,
								originalEvent: evt.originalEvent || evt,
								preventDefault: function() {
									evt.preventDefault();
								},
								stopPropagation: function() {
									evt.stopPropagation();
								},
								which: evt.which,
								target: evt.target
							}, options ) );
						if( value !== oldvalue ) {
							_this.set( key, value, {
								fromNode: true,
								changedNode: node,
								onChangeValue: value
							});
						}
					}
				});
			}			
		});
		
		if( !evt.silent ) {
			_this._trigger( 'bind:' + key, extend({
				key: key,
				$nodes: $nodes,
				node: $nodes[ 0 ] || null
			}, evt ) );
		}
		
		return _this;
	},
	
	bindOptionalNode: function( key, node, binder, evt ) {
		var _this = this;
		if( typeof key == 'object' ) {
			/*
			 * this.bindNode({ key: $() }, { on: 'evt' }, { silent: true });
			 */
			_this.bindNode( key, node, binder, true );
		} else {
			_this.bindNode( key, node, binder, evt, true );
		}
		return _this;
	},
	
	unbindNode: function( key, node, evt ) {
		var _this = this._initMK(),
			type = typeof key,
			$nodes,
			keys,
			special = _this.__special[ key ],
			i;
		
		if( key instanceof Array ) {
			for( i = 0; i < key.length; i++ ) {
				evt = node;
				_this.unbindNode( key[ i ][ 0 ], key[ i ][ 1 ] || evt, evt );
			}
			
			return _this;
		}
		
		if( type == 'string' ) {
			keys = key.split( /\s/ );
			if( keys.length > 1 ) {
				for( i = 0; i < keys.length; i++ ) {
					_this.unbindNode( keys[ i ], node, evt );
				}
				return _this;
			}
		}
		
		
		if( key === null ) {
			for( key in _this.__special ) if( _this.__special.hasOwnProperty( key ) ){
				_this.unbindNode( key, node, evt );
			}
			return _this;
		} else if( type == 'object' ) {
			for( i in key ) if( key.hasOwnProperty( i ) ) {
				_this.unbindNode( i, key[ i ], node );
			}
			return _this;
		} else if( !node ) {
			if( special && special.$nodes ) {
				return _this.unbindNode( key, special.$nodes, evt );
			} else {
				return _this;
			}
		} else if( !special ) {
			return _this;
		}
		

		$nodes = _this._getNodes( node );

		MK.each( $nodes, function( node, i ) {
			domEventsMap.remove({
				node: node,
				instance: _this
			});
			
			special.$nodes = special.$nodes.not( node );
		});
		
		_this.$nodes[ key ] = special.$nodes;
		_this.nodes[ key ] = special.$nodes[0] || null;
		
		if( key == 'sandbox' ) {
			_this.sandbox = special.$nodes[0] || null;
			_this.$sandbox = special.$nodes;
		}
		
		if( !evt || !evt.silent ) {
			_this._trigger( 'unbind:' + key, extend({
				key: key,
				$nodes: $nodes,
				node: $nodes[ 0 ] || null
			}, evt ) );
		}
		
		return _this;
	},
	
	boundAll: function( key ) {
		var _this = this._initMK(),
			__special = _this.__special,
			keys, $nodes, i;

		key = !key ? 'sandbox' : key;
		keys = typeof key == 'string' ? key.split( /\s/ ) : key;
		if( keys.length <= 1 ) {
			return keys[ 0 ] in __special ? __special[ keys[ 0 ] ].$nodes : $();
		} else {
			$nodes = $();
			for( i = 0; i < keys.length; i++ ) {
				$nodes = $nodes.add( __special[ keys[ i ] ].$nodes );
			}
			return $nodes;
		}
	},
	
	
	$bound: function( key ) {
		return this.boundAll( key );
	},
	
	
	bound: function( key ) {
		var _this = this._initMK(),
			__special = _this.__special,
			keys,
			i;
		
		key = !key ? 'sandbox' : key;
		keys = typeof key == 'string' ? key.split( /\s/ ) : key;
		if( keys.length <= 1 ) {
			return keys[ 0 ] in __special ? __special[ keys[ 0 ] ].$nodes[ 0 ] || null : null;
		} else {
			for( i = 0; i < keys.length; i++ ) {
				if( keys[ i ] in __special && __special[ keys[ i ] ].$nodes.length ) {
					return __special[ keys[ i ] ].$nodes[ 0 ];
				}
			}
		}
		
		return null;
	},
	
	
	selectAll: function( s ) {
		var _this = this._initMK();
		return /:sandbox|:bound\(([^(]*)\)/.test( s ) ? selectNodes( _this, s ) : _this.$sandbox.find( s );
	},
	
	$: function( s ) {
		return this.selectAll( s );
	},
	
	select: function( s ) {
		return this.selectAll( s )[ 0 ] || null;
	},
	
	_getNodes: function( s ) {
		return typeof s == 'string' && !/</.test( s ) && /:sandbox|:bound\(([^(]*)\)/.test( s ) ? selectNodes( this._initMK(), s ) : $( s );
	},
	
	/**
	 * @private
	 * @method Matreshka#_defineSpecial
	 * @todo Defines needed descriptor for given key
	 */
	_defineSpecial: function( key ) {
		var _this = this._initMK(),
			specialProps = _this.__special[ key ];
		if( !specialProps ) {
			specialProps = _this.__special[ key ] = {
				$nodes: $(),
				value: _this[ key ],
				getter: function() { return specialProps.value; },
				setter: function( v ) {
					_this.set( key, v, {
						fromSetter: true
					});
				},
				mediator: null
			};
			Object.defineProperty( _this, key, {
				configurable: true,
				get: function() {
					return specialProps.getter.call( _this );
				},
				set: function( v ) {
					specialProps.setter.call( _this, v );
				}
			});
		}
		
		return specialProps;
	},
	
	
	eq: function( object ) { // @IE8
		return typeof object == 'object' && object !== null && this.__id == object.__id;
	},
	
	
	defineGetter: function( key, getter ) {
		var _this = this._initMK(),
			__special,
			i;
		if( typeof key == 'object' ) {
			for( i in key ) if( key.hasOwnProperty( i ) ) {
				_this.defineGetter( i, key[ i ] );
			}
			return _this;
		}
		
		__special = _this._defineSpecial( key );
		__special.getter = function() {
			return getter.call( _this, {
				value: __special.value,
				key: key,
				self: _this
			});
		};
		
		return _this;
	},
	
	
	defineSetter: function( key, setter ) {
		var _this = this._initMK(),
			i;
		if( typeof key == 'object' ) {
			for( i in key ) if( key.hasOwnProperty( i ) ) {
				_this.defineSetter( i, key[ i ] );
			}
			return _this;
		}
		
		_this._defineSpecial( key ).setter = function( v ) {
			return setter.call( _this, v, {
				value: v,
				key: key,
				self: _this
			});
		};
		
		return _this;
	},
	
	
	
	mediate: function( keys, mediator ) {
		var _this = this._initMK(),
			type = typeof keys,
			i,
			__special;
			
		if( type == 'object' && !( keys instanceof Array ) ) {
			for( i in keys ) if( keys.hasOwnProperty( i ) ) {
				_this.mediate( i, keys[ i ] );
			}
			return _this;
		}
		
		keys = type == 'string' ? keys.split( /\s/ ) : keys; 

		for( i = 0; i < keys.length; i++ ) ( function( key ) {
			__special = _this._defineSpecial( key );
		
			__special.mediator = function( v ) {
				return mediator.call( _this, v, __special.value, key, _this );
			};
			
			_this.set( key, __special.mediator( __special.value ), {
				fromMediator: true
			})
		})( keys[ i ] );

		return _this;
	},
	
	
	linkProps: function( key, keys, getter, setOnInit ) {
		var keys = typeof keys == 'string' ? keys.split( /\s/ ) : keys,
			on_Change = function( evt ) {
				var values = [],
					_protect = evt._protect = evt._protect || evt.key + this.__id;
			
				if( _protect !== key + self.__id ) {
					if( typeof keys[ 0 ] == 'object' ) {
						for( i = 0; i < keys.length; i += 2 ) {
							_this = keys[ i ];
							
							_keys = typeof keys[ i + 1 ] == 'string' ? keys[ i + 1 ].split( /\s/ ) : keys[ i + 1 ];
							for( j = 0; j < _keys.length; j++ ) {
								values.push( _this[ _keys[ j ] ] );
							}
						}
					} else {
						for( i = 0; i < keys.length; i++ ) {
							_key = keys[ i ];
							_this = self;
							values.push( _this[ _key ] );
						}
					}
					self.set( key, getter.apply( self, values ), extend({}, evt, {
						fromDependency: true
					}));
				}
				
			},
			_this, _key, _keys, i, j,
			self = this._initMK();
		getter = getter || function( value ) { return value; };
		
		
		if( typeof keys[ 0 ] == 'object' ) {
			for( i = 0; i < keys.length; i += 2 ) {
				_this = keys[ i ]._initMK();
				_keys = typeof keys[ i + 1 ] == 'string' ? keys[ i + 1 ].split( /\s/ ) : keys[ i + 1 ];
				for( j = 0; j < _keys.length; j++ ) {
					_this._defineSpecial( _keys[j] );
					_this._on( '_rundependencies:' + _keys[j], on_Change );
				}
			}
		} else {
			for( i = 0; i < keys.length; i++ ) {
				_key = keys[ i ];
				_this = this;
				_this._defineSpecial( _key );
				_this._on( '_rundependencies:' + _key, on_Change );
			}
		}
		
		setOnInit !== false && on_Change.call( typeof keys[ 0 ] == 'object' ? keys[ 0 ] : this, {
			key: typeof keys[ 0 ] == 'object' ? keys[ 1 ] : keys[ 0 ]
		});
		
		return this;
	},
	
	
	get: function( key ) {
		return this[ key ];
	},
	
	
	set: function( key, v, evt ) {
		var _this = this,
			type = typeof key,
			special, prevVal, newV, i,
			isNaN = Number.isNaN || function(value) {
				return typeof value == 'number' && isNaN(value);
			};
			
		if( type == 'undefined' ) return _this;
		
		if( type == 'object' ) {
			for( i in key ) if( key.hasOwnProperty( i ) ) {
				_this.set( i, key[ i ], v );
			}
			return _this;
		}
		
		if( !_this.__special || !_this.__special[ key ] ) {
			_this[ key ] = v;
			return _this;
		}
		
		special = _this.__special[ key ];
		prevVal = special.value;

		evt = evt || {};
		
		if( special.mediator && v !== prevVal && !evt.skipMediator && !evt.fromMediator ) {
			newV = special.mediator.call( _this, v, prevVal, key, _this );
		} else {
			newV = v;
		}
		
		special.value = newV;

		if( newV !== prevVal || evt.force || evt.forceHTML || newV !== v && !isNaN( newV ) ) {
			evt = extend({}, evt, {
				value: newV,
				previousValue: prevVal,
				key: key,
				node: special.$nodes[ 0 ] || null,
				$nodes: special.$nodes,
				self: _this
			});
			
			if( !evt.silentHTML ) {
				_this._trigger( '_runbindings:' + key, evt );
			}
		}
		
		if( ( newV !== prevVal || evt.force ) && !evt.silent ) {
			_this
				._trigger( 'change:' + key, evt )
				._trigger( 'change', evt )
			;
		}
		
		if( ( newV !== prevVal || evt.force || evt.forceHTML ) && !evt.skipLinks ) {
			_this._trigger( '_rundependencies:' + key, evt );
		}
		
		return _this;
	},
	
	
	remove: function( key, evt ) {
		var _this = this._initMK(),
			exists,
			keys = String( key ).split( /\s/ ),
			i;
			
		evt = extend({
			keys: keys
		}, evt );
		
		for( i = 0; i < keys.length; i++ ) {
			exists = keys[ i ] in _this;
			if( exists ) {
				evt.key = keys[ i ];
				evt.value = _this[ keys[ i ] ];
				
				_this.unbindNode( keys[ i ] )._off( 'change:' + keys[ i ] );
				
				delete _this.__special[ keys[ i ] ];
				
				try { // @IE8 fix
					delete _this[ keys[ i ] ];
				} catch(e) {}
				
				if( !evt || !evt.silent ) {
					_this
						._trigger( 'delete', evt )
						._trigger( 'delete:' + keys[ i ], evt )
					;
				}
			}
		}
		
		return _this;
	},
	
	
	define: function( key, descriptor ) {
		var _this = this;
		if( typeof key == 'object' ) {
			for( var p in key ) {
				_this.define( p, key[ p ] );				
			}		
			return _this;
		}
		Object.defineProperty( _this, key, descriptor );
		return _this;
	},
	
	delay: function( f, delay, thisArg ) {
		var _this = this;
		if( typeof delay == 'object' ) {
			thisArg = delay;
			delay = 0;
		}
		
		setTimeout( function() {
			f.call( thisArg || _this );
		}, delay || 0 );
		
		return _this;
	},
	
	/**
	 * @private
	 * Experimental simple template engine
	 */
	_parseBindings: function( node ) {
		var _this = this._initMK(),
			$nodes = ( typeof node == 'string' ? MK.$.parseHTML( node.replace( /^\s+|\s+$/g, '' ) ) : $( node ) );
		
		var all = $nodes.find( '*' ).add( $nodes );
			
		MK.each( all, function( node ) {
			
			( function f( node ) {
				if( node.tagName !== 'TEXTAREA' ) {
					MK.each( node.childNodes, function( childNode ) {
						var previous = childNode.previousSibling,
							textContent;
							
						if( childNode.nodeType == 3 && ~childNode.nodeValue.indexOf( '{{' ) ) {
							textContent = childNode.nodeValue.replace( /{{([^}]*)}}/g, '<mk-bind mk-html="$1"></mk-bind>' );
							//console.log( node, node.nodeType );
							if( previous ) {
								previous.insertAdjacentHTML( 'afterend', textContent );
							} else {
								node.insertAdjacentHTML( 'afterbegin', textContent )
							}
							
							node.removeChild( childNode );
						} else if( childNode.nodeType == 1 ) {
							f( childNode );
						}
					});
				}
			})( node );
		});
		
		// reload list of nodes
		all = $nodes.find( '*' ).add( $nodes );
		
		MK.each( all, function( node ) {
			var bindHTMLKey = node.getAttribute( 'mk-html' );
			if( bindHTMLKey ) {
				_this.bindNode( bindHTMLKey, node, MK.binders.innerHTML() );
				node.removeAttribute( 'mk-html' );
			}
			
			MK.each( node.attributes, function( attr ) {
				var attrValue = trim( attr.value ),
					attrName = attr.name,
					keys,
					key,
					binder;
					
				if( ~attrValue.indexOf( '{{' ) ) {
					keys = attrValue.match( /{{[^}]*}}/g ).map( function( key ) {
						return key.replace( /{{(.*)}}/, '$1' );
					});
					
					if( keys.length == 1 && /^{{[^}]*}}$/g.test( attrValue ) ) {
						key = keys[0];
					} else {
						key = MK.randomString();
						_this.linkProps( key, keys, function() {
							var v = attrValue;
							keys.forEach( function( _key ) {
								v = v.replace( new RegExp( '{{'+_key+'}}', 'g' ), _this[ _key ] );
							});
							
							return v;
						});
					}
				
					if( ( attrName == 'value' && node.type != 'checkbox' 
							|| attrName == 'checked' && node.type == 'checkbox' ) 
						&& MK.lookForBinder( node ) ) {
						_this.bindNode( key, node );
					} else {
						_this.bindNode( key, node, MK.binders.attribute( attrName ) );
					}
				}
			});
		}, _this );
		
		return $nodes;
	},
	/**
	 * @method Matreshka#_initMK
	 * @private
	 */
	_initMK: function() {
		var _this = this;
		if( !_this.isMKInitialized ) {
			extend( _this, {
				isMKInitialized: true,
				Matreshka: MK,
				'sandbox': null,
				/**
				* Instance id
				* @private
				* @since 0.0.2
				* @member {number}
				*/
				__id: 'mk' + MK.randomString(),
				/**
				* This object contains all events
				* @private
				* @member {object}
				*/
				__events: {},
				/**
				* This object contains all special values
				* @private
				* @member {object}
				*/
				__special: {},
				/**
				 * Object contains bound nodes
				 * @private
				 * @member {object}
				 * @since 1.0.5
				 */
				$nodes: {},
				nodes: {}
			});
		}
		
		return _this;
	},
	toString: function() {
		return '[object Matreshka]'	
	},
	constructor: function Matreshka() {
		this._initMK();
	},
	getAnswerToTheUltimateQuestionOfLifeTheUniverseAndEverything: function() {
		this.delay( function() {
			alert( 42 );
		}, 1000*60*60*24*365.25*7.5e6 );
	}
}),


extend = MK.extend = function( o1, o2 ) {
	var i, j;
	if( o1 ) for( i = 1; i < arguments.length; i++ ) {
		o2 = arguments[ i ];
		if( o2 ) for( j in o2 ) if( o2.hasOwnProperty( j ) ) {
			o1[ j ] = o2[ j ];
		}
	}
	return o1;
},

each = MK.each = function( o, f, thisArg ) {
	if( !o ) return;
	if( 'length' in o ) [].forEach.call( o, f, thisArg );
	else for( var i in o ) if( o.hasOwnProperty( i ) ) {
		f.call( thisArg, o[ i ], i, o );
	}
	return o;
};

extend( MK, {
	version: 'dev',
	
	binders: binders,
	
	defaultBinders: [],
	
	Class: Class,
	
	$: $,
	
	$b: $b,
	
	useAs$: function( _$ ) {
		return MK.$ = $ = _$;
	},
	
	isXDR: Class.isXDR,
	
	noop: function() {},
	
	debounce: function ( f, d, thisArg ) {
		var timeout;
		if( typeof d !== 'number' ) {
			thisArg = d;
			d = 0;
		}
		return function() {
			var args = arguments,
				_this = this;
			clearTimeout( timeout );
			timeout = setTimeout( function() {
				f.apply( thisArg || _this, args );
			}, d || 0 );
		};
	},
	
	randomString: function() {
		return ( new Date().getTime() - new Date( 2013, 4, 3 ).getTime() ).toString( 36 ) + Math.floor( Math.random() * 1679616 ).toString( 36 );
	},
	
	lookForBinder: function( node ) {
		var result,
			ep = MK.defaultBinders,
			i;
		for( i = 0; i < ep.length; i++ ) {
			if( result = ep[ i ].call( node, node ) ) {
				return result;
			}
		}
	},
	
	to: function to( data ) {
		var result,
			i;
		if( typeof data == 'object' ) {
			if( 'length' in data ) {
				result = [];
				for( i = 0; i < data.length; i++ ) {
					result[ i ] = to( data[ i ] );
				}
				result = new MK.Array().recreate( result );
			} else {
				result = {};
				for( i in data ) if( data.hasOwnProperty( i ) ) {
					result[i] = to( data[ i ] );
				}
				result = new MK.Object( result )
			}
		} else {
			result = data;
		}
		
		return result;
	}
});

MK.defaultBinders.push( function( node ) {
	var tagName = node.tagName,
		b;
		
	if( tagName == 'INPUT' ) {
		b = binders.input( node.type );
	} else if( tagName == 'TEXTAREA' ) {
		b = binders.textarea();
	} else if( tagName == 'SELECT' ) {
		b = binders.select( node.multiple );
	} else if( tagName == 'PROGRESS' ) {
		b = binders.progress();
	}
	
	return b;
});



return MK;
}));