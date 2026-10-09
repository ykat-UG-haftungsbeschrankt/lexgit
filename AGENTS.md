# Coding conventions

## Electron builds

- When modifying source code, do not rebuild or package the Electron app unless
  the user explicitly requests it.
- Use targeted checks or browser validation instead. Do not run
  `electron:build`, `electron:pack`, `electron:dist`, or the VS Code
  **Build Electron application** task as routine validation.

## Line length

- Limit each line of code or data to 80 characters, including indentation.
  Wrap long declarations, expressions, comments, and data without changing
  their meaning.

## Comparisons

- Never use `==`, `===`, `!=`, or `!==` to compare values of the `float_t`,
  `float32_t`, `float64_t`, or `double_t` families. Use relational comparisons
  for bounds and an explicitly chosen, domain-appropriate tolerance for
  approximate equality.
- For non-floating-point values, use strict equality (`===`) and strict
  inequality (`!==`) instead of `==` and `!=`.
- For operators `==`, `===`, `!=`, `!==`, `>=`, and `<=`,
  place a literal or constant on the left and the variable on the right,
  for example `0 === count` and `null !== value`. This helps catch accidental
  use of `=`; the restrictions above still apply.
- When reversing `>=` or `<=`, preserve the comparison's meaning, for
  example use `0 <= count` instead of `count >= 0`.
- This operand-order rule does not apply to `<` and `>`. Use the order that
  makes the comparison clearest.

## Types

- Use `utf8_t` for UTF-8 strings.
- Use the existing global type aliases with C-style numeric semantics:
  - `bool_t` for booleans.
  - `size_t` for sizes and counts.
  - `uint_t` for unsigned integers; `uint8_t`, `uint16_t`, `uint32_t`, or
    `uint64_t` when a specific width is required.
  - `int_t` for signed integers; `int8_t`, `int16_t`, `int32_t`, or `int64_t`
    when a specific width is required.
  - `float_t`, `float32_t`, `float64_t`, or `double_t` for floating-point
    values, according to the intended precision and existing API conventions.
  - `string_t` for general strings; prefer `utf8_t` for UTF-8 strings.
- Prefer these specific aliases over primitive `number`, `boolean`, and `string`
  annotations. Reuse the global declarations rather than redeclaring them.
- These aliases document intent but do not enforce integer ranges, widths,
  encoding, or floating-point precision at runtime. Validate constraints when
  needed; in particular, a `uint64_t` or `int64_t` alias does not make
  JavaScript numbers exact beyond their safe integer range.

## Lifecycle and cleanup

- Every Office class must provide a public `destructor()` method, even if it has
  no resources to release. Override an inherited implementation when additional
  cleanup is needed.
- Explicitly invoke `destructor()` when an owned Office instance reaches the end
  of its lifetime. JavaScript does not automatically call destructors when
  objects go out of scope.
- Use `try/finally` for locally owned instances so cleanup runs on success and
  failure. For instances retained beyond the current scope, their owner must
  call `destructor()` during its own cleanup.
- Make destructors safe to call more than once. Cancel pending work, detach
  listeners, and release owned resources and child instances. Do not destroy
  borrowed instances.
- Destructors must never throw or return a rejected promise. Prefer a single
  `try` block around cleanup, followed by an empty `catch(UNUSED_e)` block,
  matching the destructor in `OfficeAnimationEasing`. This is an explicit
  exception to the general rule against swallowing errors.
- With this pattern, a failed cleanup step skips subsequent steps in the
  `try` block. Do not assume all resources are released after a failure.
- If cleanup is asynchronous, return a promise from `destructor()` and await it.
  Preserve inherited cleanup when overriding a destructor.

## Promises

- Do not leave floating or dangling promises. Await each promise, return it to a
  caller responsible for handling it, or attach explicit completion and
  rejection handling for intentional background work.
- Do not use `void` alone to discard a promise; it does not handle rejection.
- Propagate failures or report them through the existing error-handling
  mechanism.
  Do not swallow rejections with empty handlers, except for the preferred
  destructor cleanup pattern described above.
- Ensure callback APIs that do not await returned promises explicitly handle any
  asynchronous work started by their callbacks.

## Comments

- Use `//` for inline comments, not `/* ... */`.

## Braces

- Do not insert a space before an opening brace in declarations, methods, or
  control-flow bodies. Use `interface OfficeDestructorInterface{`,
  `if(condition){`, `else{`, `for(...){`, `while(condition){`, and `try{`
  rather than placing a space before `{`.
- Never omit curly braces around control-flow bodies, including `if`, `else`,
  `for`, `for...in`, `for...of`, `while`, and `do...while`, even for a single
  statement.
  Use explicit blocks for arrow-function bodies as well.

## Classes and naming

- End every class, interface, and enum declaration with a semicolon after the
  closing brace (`};`).
- Avoid method chaining and fluent APIs. Do not return `this` solely to enable
  chaining; setters and actions without a meaningful result should return
  `void`. Call methods in separate statements.
- Avoid method overloads and catch-all arguments such as
  `setValue(value:utf8_t|uint8_t)`.
  Use distinct, specifically typed methods for different value types, for
  example `setUtf8(str:utf8_t)` and `setUint8(num:uint8_t)`.
- Use UpperCamelCase (PascalCase) for class, interface, and enum names, for
  example `OfficeAnimation`, `OfficeAnimationOptions`, and
  `OfficeExceptionCode`.
- Use lowerCamelCase (camelCase) for class fields and methods, for example
  `frameCount` and `getValue()`. Internal members retain their leading
  underscore, for example `_frameCount` and `_onTimeout()`.
- Avoid property accessor syntax such as `get value()` and `set value(value)`.
  Use explicit methods such as `getValue()` and `setValue(value)` instead.
- Prefix internal class fields, including internal static fields, with an
  underscore, for example `_timeout` or `_instance`. Public fields do not
  require an underscore prefix.
- Initialize instance fields in the constructor, not in field declarations.
  Declare fields with explicit types and assign their initial values after
  `super()` in derived classes. Static fields are not instance fields and
  should not be initialized by an instance constructor.
- Declare internal class methods as `protected`, not `private`, unless they
  require public visibility for access by other framework components.
- Prefix internal method names with an underscore, for example `_onTimeout()`.
- Prefix public functions and methods intended only for internal framework use
  with an underscore, including static methods, for example `_dispatch()`.
  Public visibility does not make these functions part of the consumer API.
  Keep consumer-facing public functions and methods unprefixed.
- Move inline callbacks and closures inside constructors or other class methods
  into named `protected` methods whose names start with an underscore.
- When passing an extracted method as a callback, use `.bind(this)` if it needs
  access to the instance.
- Preserve callback arguments and per-call state when extracting closures.
  Pass the required state explicitly or store it on the instance when
  appropriate; do not replace independent per-call state with shared mutable
  instance state.

Example:

```ts
class Example{
	protected readonly _timeout:OfficeTimeout;

	constructor(){
		this._timeout = new OfficeTimeout(this._onTimeout.bind(this),1000);
	}

	protected _onTimeout():void{
		// Handle the timeout.
	}
};
```