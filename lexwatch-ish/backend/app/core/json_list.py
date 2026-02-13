"""Custom SQLAlchemy type for storing Python lists as JSON text in SQLite."""

import json

from sqlalchemy import Text, TypeDecorator


class JSONList(TypeDecorator):
    """Stores a Python list as a JSON-encoded TEXT column. Drop-in replacement for ARRAY(String)."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return "[]"
        return json.dumps(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return []
        return json.loads(value)
