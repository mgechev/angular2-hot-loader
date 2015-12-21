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

import {TemplateCompiler} from 'angular2/src/compiler/template_compiler';
import {ViewResolver} from 'angular2/src/core/linker/view_resolver';
import {AppView} from 'angular2/src/core/linker/view';
import {RuntimeMetadataResolver} from 'angular2/src/compiler/runtime_metadata';
import {internalView} from 'angular2/src/core/linker/view_ref';

import {MessageFormat} from '../common';

System.import('typescript/lib/typescript');

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
    function runChangeDetection(view: AppView) {
      if (visited.has(view)) {
        return;
      }
      visited.set(view, true);
      view.changeDetector.detectChanges();
      view.views.forEach(runChangeDetection);
    }
    this.app.injector
      .get(DynamicComponentLoader).loadAsRoot(this.root, null, this.app.injector)
      .then(ref => {
        console.log('View patched');
        console.log('Running change detection');
        console.log('-------------------------');
        // TODO remove the interval here
        clearInterval(this.cdInterval);
        this.cdInterval = setInterval(_ => {
          let view = internalView(<any>ref.hostView);
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


let proxies = new Map<string, any>();

function proxyDirective(current: any) {
  let metadata = Reflect.getMetadata('annotations', current);
  proxies.set(current.name, proxyFactory.getProxy(current));
  if (!metadata) return;
  metadata.forEach(current => {
    if ((current instanceof ComponentMetadata || current instanceof ViewMetadata) &&
     current.directives instanceof Array) {
      current.directives.forEach(proxyDirectives);
    }
    if (current.constructor && current.constructor.name === 'RouteConfig') {
      current.configs.map(c => c.component).forEach(proxyDirectives);
    }
  });
}

function proxyDirectives(current: Type | any[]) {
  if (current instanceof Array) {
    current.forEach(proxyDirectives);
  } else {
    proxyDirective(<Type>current);
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

function processMessage(data: MessageFormat) {
  let filename = data.filename;
  if (filename.endsWith('.html')) {
    updateView('templateUrl', data);
  } else if (filename.endsWith('.css')) {
    updateView('styleUrls', data);
  } else {
    let oldTranspiler = (<any>System).transpiler;
    (<any>System).transpiler = 'typescript';
    (<any>System).delete(filename);
    (<any>System).load(filename)
    .then(module => {
      for (let ex in module) {
        if (proxies.has(ex)) {
          proxies.get(ex).update(module[ex]);
        }
      }
      (<any>System).transpiler = oldTranspiler;
    })
    .catch(e => {
      console.error(e);
    });
    eval(data.content);
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
  proxyDirectives(appComponentType);

  initialize(url);

  return bootstrapped;
};
