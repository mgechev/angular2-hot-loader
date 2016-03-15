import {isPresent} from 'angular2/src/facade/lang';
import {
  BROWSER_PROVIDERS,
} from 'angular2/src/platform/browser_common';
import {
  BROWSER_APP_PROVIDERS
} from 'angular2/platform/browser';

import {ReflectionCapabilities} from 'angular2/src/core/reflection/reflection_capabilities';

import {
  PlatformRef,
  ComponentMetadata,
  ViewMetadata,
  DynamicComponentLoader,
  ApplicationRef,
  Type,
  provide,
  Injector,
  Injectable,
  ComponentRef,
  platform,
  reflector
} from 'angular2/core';

import {RouteRegistry} from 'angular2/router';

import {TemplateCompiler} from 'angular2/src/compiler/template_compiler';
import {ViewResolver} from 'angular2/src/core/linker/view_resolver';
import {AppView} from 'angular2/src/core/linker/view';
import {AppElement} from 'angular2/src/core/linker/element';
import {RuntimeMetadataResolver} from 'angular2/src/compiler/runtime_metadata';

import {MessageFormat} from '../common';

class Node {
  children: Node[] = [];
  bindings: any;
}

let proxyFactory = (function () {
  let _injector: Injector = null;
  let _root: Type = null;
  return {
    initialize(injector: Injector, rootComponent: Type) {
      _injector = injector;
      _root = rootComponent;
    },
    getProxy(component: Type) {
      let proxy: ComponentProxy = _injector.resolveAndInstantiate(provide(ComponentProxy, { useClass: ComponentProxy }));
      proxy.update(component);
      proxy.setRoot(_root);
      return proxy;
    }
  }
}());

@Injectable()
export class ComponentProxy {
  private cdInterval: any;
  private component: Type;
  private root: Type;
  private parents: string[] = [];
  constructor(
    private compiler: TemplateCompiler,
    private resolver: ViewResolver,
    private app: ApplicationRef,
    private loader: DynamicComponentLoader,
    private runtimeResolver: RuntimeMetadataResolver
  ) {}

  public update(component: Type) {
    if (!this.component) {
      this.component = component;
      return;
    }
    this.updatePrototype(component);
    this.updateMetadata(component);
    let annotations = Reflect.getMetadata('annotations', component);
    let isComponent = false;
    annotations.forEach(a => {
      if (a instanceof ComponentMetadata) {
        isComponent = true;
        return;
      }
    });
    if (isComponent) {
      this.refresh();
    }
  }

  public refresh() {
    console.log('Patching components');
    this.compiler.clearCache();
    (<any>this.resolver)._cache = new Map();
    (<any>this.runtimeResolver)._cache = new Map();
    let visited;
    let visitedViews = new Map();
    let root = new Node();
    function preserveInjectors(view, node) {
      if (visitedViews.has(view)) {
        return;
      }
      visitedViews.set(view, true);
      let data = [];
      view.elementInjectors.forEach(inj => {
        const strategy = inj._strategy.injectorStrategy;
        const currentData = {};
        for (let prop in strategy) {
          if (/^obj\d+/.test(prop)) {
            currentData[prop] = strategy[prop];
          }
        }
        data.push(currentData);
      });
      node.bindings = data;
      node.children = view.views.map(e => preserveInjectors(e, new Node()));
      return node;
    }
    function restoreInjectors(view, node) {
      if (visitedViews.has(view)) {
        return;
      }
      visitedViews.set(view, true);
      view.elementInjectors.forEach((inj, i) => {
        const strategy = inj._strategy.injectorStrategy;
        for (let prop in strategy) {
          if (/^obj\d+/.test(prop)) {
            strategy[prop] = node.bindings[i][prop];
          }
        }
      });
      view.views.forEach((v, i) => restoreInjectors(v, node.children[i]));
    }
    function runChangeDetection(view: any) {
      if (visited.has(view) || !view) {
        return;
      }
      console.log(view.allNodes);
      visited.set(view, true);
      view.changeDetector.detectChanges();
      // view.views.forEach(e => runChangeDetection(e.componentView));
    }
    preserveInjectors((<any>this.app)._rootComponents[0].hostView._view, root);
    this.app.injector
      .get(DynamicComponentLoader).loadAsRoot(this.root, null, this.app.injector)
      .then(ref => {
        console.log('View patched');
        console.log('Running change detection');
        console.log('-------------------------');
        // TODO remove the interval here
        clearInterval(this.cdInterval);
        visitedViews = new Map();
        // root.injectors[0]._proto.protoInjector._strategy;
        restoreInjectors(ref.hostView._view, root);
        this.cdInterval = setInterval(_ => {
          let view = ref.hostView._view;
          visited = new Map();
          runChangeDetection(view);
        }, 100);
    });
  }

  public get() {
    return this.component;
  }

  public setRoot(root: Type) {
    this.root = root;
  }

  public getParents() {
    return this.parents;
  }

  public addParent(parentName: string) {
    this.parents.push(parentName);
  }

  public removeParent(parentName: string) {
    this.parents.splice(this.parents.indexOf(parentName), 1);
  }

  private updatePrototype(component) {
    let currentProto = this.component.prototype;
    let newProto = component.prototype;

    // Copy added properties
    Object.getOwnPropertyNames(newProto).forEach(name => {
      currentProto[name] = newProto[name];
    });

    // Delete removed properties
    Object.getOwnPropertyNames(currentProto).forEach(name => {
      if(!newProto.hasOwnProperty(name)) {
        delete currentProto[name];
      }
    });
  }

  private updateMetadata(component) {
    let keys = Reflect.getMetadataKeys(component);
    keys.forEach(key => {
      let val = Reflect.getMetadata(key, component);
      Reflect.defineMetadata(key, val, this.component);
    });
  }
}


let proxies = new Map<string, ComponentProxy>();

function proxyDirective(cmp: any, parent: any) {
  proxies.set(cmp.name, proxyFactory.getProxy(cmp));
  if (parent) {
    let proxy = proxies.get(cmp.name);
    proxy.addParent(parent.name);
  }
  let metadata = Reflect.getMetadata('annotations', cmp);
  if (!metadata) return;
  metadata.forEach(current => {
    if ((current instanceof ComponentMetadata || current instanceof ViewMetadata) &&
     current.directives instanceof Array) {
      current.directives.forEach(proxyDirectives.bind(null, cmp));
    }
    if (current.constructor && current.constructor.name === 'RouteConfig') {
      current.configs.map(c => c.component).forEach(proxyDirectives.bind(null, cmp));
    }
  });
}

function proxyDirectives(parent, current: Type | any[]) {
  if (current instanceof Array) {
    current.forEach(proxyDirectives.bind(null, parent));
  } else {
    proxyDirective(<Type>current, parent);
  }
}

function connect(url) {
  return new Promise<WebSocket>((resolve, reject) => {
    var ws = new WebSocket(url);
    ws.onopen = function (e) {
      resolve(ws);
    };
  });
}

function reconnect(url) {
  let interval = setInterval(_ => {
    connect(url)
    .then(ws => {
      clearInterval(interval);
      initialize(url);
    });
  }, 3000);
}

// TODO move to the proxy class
function updateView(type, data) {
  let iter = proxies.values();
  let current = iter.next();
  while (!current.done) {
    var proxy = current.value;
    var cmp = proxy.get();
    var metadata = Reflect.getOwnMetadata('annotations', cmp);
    metadata.forEach(meta => {
      if (meta instanceof ComponentMetadata && meta[type]) {
        let oldVals = meta[type];
        if (!(oldVals instanceof Array)) {
          oldVals = [oldVals];
        }
        oldVals.forEach(oldVal => {
          var normalizedPath = oldVal.replace(/^\./, '');
          if (data.filename.endsWith(normalizedPath)) {
            proxy.refresh();
          }
        });
      }
    });
    current = iter.next();
  }
}

function updateDirectiveDefinition(directiveName, newDefinition) {
  let proxy = proxies.get(directiveName);
  let component = proxy.get();
  proxy.getParents().forEach(parent => {
    let parentProxy = proxies.get(parent);
    let cmp = parentProxy.get();
    let metadata = Reflect.getMetadata('annotations', cmp);
    if (!metadata) return;
    metadata.forEach(current => {
      if ((current instanceof ComponentMetadata || current instanceof ViewMetadata) &&
      current.directives instanceof Array) {
        current.directives = current.directives.filter(directive => {
          return directive.name !== directiveName;
        });
        current.directives.push(newDefinition);
      }
      // TODO: Need to reconfigure the routeregistry associated to this component
      if (current.constructor && current.constructor.name === 'RouteConfig') {
        current.configs.forEach(c => {
          if (c.component.name === directiveName) {
            c.component = newDefinition;
          }
        });
      }
    });
  });
}

function patchDirective(directiveName, newDefinition) {
  let proxy = proxies.get(directiveName);
  if (!proxy) {
    return proxyDirective(newDefinition, null);
  }
  let component = proxy.get();
  if (!component || component.toString() !== newDefinition.toString()) {
    updateDirectiveDefinition(directiveName, newDefinition);
  } else {
    proxies.get(directiveName).update(newDefinition);
  }
}

function processMessage(data: MessageFormat) {
  let filename = data.filename;
  if (filename.endsWith('.html')) {
    updateView('templateUrl', data);
  } else if (filename.endsWith('.css')) {
    updateView('styleUrls', data);
  } else {
    let path = `${location.protocol}//${location.host}/${filename}`;
    (<any>System).delete(path);
    (<any>System).define(path, data.content)
//    (<any>System).transpiler = 'typescript';
//    let baseURL = (<any>System).baseURL.substring(0, (<any>System).baseURL.length - 1);
//    if((<any>System).has(baseURL + filename)) {
//      (<any>System).delete(baseURL + filename);
//    } else {
//      (<any>System).delete(filename);
//    }
//    (<any>System).load(baseURL + filename)
    .then(module => {
      module = module.module.module;
      for (let ex in module) {
        if (proxies.has(ex)) {
          patchDirective(ex, module[ex]);
        }
      }
    })
    .catch(e => {
      console.error(e);
    });
  }
}

let url = 'ws://localhost:<%= PORT %>';
function initialize(url) {
  connect(url)
  .then(ws => {
    ws.onmessage = function (e) {
      let data = JSON.parse(e.data);
      try {
        processMessage(data);
      } catch (e) {
        console.error(e);
      }
    };
    ws.onclose = reconnect.bind(null, url);
  });
}

export function ng2HotLoaderBootstrap(
    appComponentType: Type,
    customProviders?: Array<any>): Promise<ComponentRef> {

  reflector.reflectionCapabilities = new ReflectionCapabilities();
  let appProviders =
      isPresent(customProviders) ? [BROWSER_APP_PROVIDERS, customProviders, ComponentProxy] : BROWSER_APP_PROVIDERS;

  let currentPlatform: PlatformRef = platform(BROWSER_PROVIDERS);
  let currentApp = currentPlatform.application(appProviders);
  let bootstrapped = currentApp.bootstrap(appComponentType);

  proxyFactory.initialize(currentApp.injector, appComponentType);
  proxyDirectives(null, appComponentType);

  initialize(url);

  return bootstrapped;
};
