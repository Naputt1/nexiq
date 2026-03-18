import { useCallback, useState } from "react";

export const CallbackFactory = () => {
  const [count, setCount] = useState(0);

  // Function returning a function (factory)
  const getIncrementer = useCallback(() => {
    return (amount: number) => count + amount;
  }, [count]);

  const inc = getIncrementer();

  return (
    <div onClick={() => console.log(inc(1))}>
      {count}
    </div>
  );
};

const debounce = (fn: any, ms: number) => fn;
const Constants = { SEARCH_TIMEOUT_MILLISECONDS: 500 };
const actions = { searchProfiles: async (term: string, opts: any) => ({ data: true }) };
const Load = { DONE: 'done', FAILED: 'failed' };

export const CallbackDebounced = () => {
  const [searchState, setSearchState] = useState('');
  const group = { id: '123' };

  const doSearch = useCallback(debounce(async (term: string) => {
    const res = await actions.searchProfiles(term, {in_group_id: group.id});
    if (res.data) {
        setSearchState(Load.DONE);
    } else {
        setSearchState(Load.FAILED);
    }
  }, Constants.SEARCH_TIMEOUT_MILLISECONDS), [actions.searchProfiles]);

  return <div onClick={() => doSearch('test')}>{searchState}</div>;
};
