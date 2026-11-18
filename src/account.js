export function createAccountLifecycle({ open, reset, ready, failed }) {
  let store;
  let owner;
  let transitions = Promise.resolve();

  async function switchAccount(user) {
    if ((user?.id ?? null) === owner) return;
    try {
      store?.close();
      store = null;
      owner = null;
      reset(user);
      if (!user) return;
      store = await open(user);
      owner = user.id;
      ready(store, user);
    } catch (error) {
      store?.close();
      store = null;
      owner = null;
      failed(error);
    }
  }

  return {
    get store() { return store; },
    switchTo(user) {
      const next = transitions.then(() => switchAccount(user));
      transitions = next.catch(() => {});
      return next;
    }
  };
}
