FROM public.ecr.aws/lambda/python:3.12

COPY requirements.txt ${LAMBDA_TASK_ROOT}/
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt

# DuckDB extensions are baked in; Lambda's home directory is read-only at runtime.
ENV DUCKDB_EXT_DIR=/opt/duckdb_ext
RUN python -c "import duckdb; c = duckdb.connect(); c.execute(\"SET extension_directory='/opt/duckdb_ext'\"); c.execute('INSTALL httpfs'); c.execute('INSTALL spatial')"

COPY smoke ${LAMBDA_TASK_ROOT}/smoke
COPY handler.py ${LAMBDA_TASK_ROOT}/

CMD ["handler.handler"]
