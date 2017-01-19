**Note that the project is in very early stage of development. It is still not ready for usage but you can give it a try and share your feedback.**

# Angular2 Hot Loader

Hot loader for Angular 2, inspired by [react-hot-loader](https://github.com/gaearon/react-hot-loader).

[![](http://s12.postimg.org/49uakspe5/Screen_Shot_2015_10_26_at_01_50_48.png)](https://www.youtube.com/watch?v=S9pKbi3WrCM)

## How to use?

```
npm install angular2-hot-loader
```

You can start the hot loader server by:

```ts
import * as ng2HotLoader from 'angular2-hot-loader';

ng2HotLoader.listen({
  port: 4412,
  projectRoot: __dirname
});
```

Somewhere inside of your templates add:

```ts
System.import('//localhost:4412/ng2-hot-loader')
  .then(module => {
    module.ng2HotLoaderBootstrap(AppCmp, [PROVIDERS]);
  });
```

Now you can watch your file system with any module you feel comfortable with. Once you detect a change in the target files use:

```ts
ng2HotLoader.onChange([fileName]);
```

Now on each edit the changes should be pushed to the client.

## Roadmap

- [x] Update the component's inline templates
- [x] Update the component's external templates
- [x] Update the component's altered methods
- [x] Update the component's removed methods
- [x] Allow definition of new components
- [x] Update the component's metadata
- [ ] Update the component's constructor on change
    - [ ] For components declared in the `directives` array
    - [ ] For components declared in the `@RouteConfig` definition
- [ ] Preserve the state of the components (i.e. the values of the bindings)
- [ ] Preserve the instantiated tokens in the element injectors

## Features

- Add new methods to existing components
- Clean removed methods from existing components
- Support changes of external and inline templates
- Allows adding inputs and outputs (events and properties) to the components

## Limitations

- Does not push changes in services & pipes
- Does not update component's constructor

# License

MIT

