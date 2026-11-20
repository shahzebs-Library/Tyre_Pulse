import json, sys


def load(path):
    t = open(path).read()
    try:
        o = json.loads(t)
        if isinstance(o, list):
            o = o[0]
        if isinstance(o, dict) and 'result' in o:
            t = o['result']
        elif isinstance(o, dict) and 'text' in o:
            t = o['text']
    except Exception:
        pass
    s = t.find('[', t.find('<untrusted-data-'))
    e = t.rfind(']', 0, t.rfind('</untrusted-data-'))
    return json.loads(t[s:e + 1])


if __name__ == '__main__':
    d = load(sys.argv[1])
    print(len(d), list(d[0].keys()))
