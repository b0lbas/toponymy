import osmium

class Counter(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.c = 0
    def node(self, n):
        try:
            if n.tags.get('place') in {'city','town','village','hamlet'}:
                self.c += 1
        except Exception:
            pass

if __name__ == '__main__':
    import sys
    p = sys.argv[1]
    h = Counter()
    h.apply_file(p, locations=False)
    print(p, h.c)
