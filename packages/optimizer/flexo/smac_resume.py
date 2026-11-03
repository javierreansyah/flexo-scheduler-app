"""Resume relocated SMAC checkpoints without offering destructive restarts."""
import json
import os


def check_resume_scenario(scenario):
    from smac import Scenario

    directory = scenario.output_directory
    path = directory/'scenario.json'
    if not path.exists():
        return
    previous = Scenario.load(directory)
    # The output location is execution metadata, not a search setting.
    object.__setattr__(previous, 'output_directory', directory)
    if previous != scenario or previous.configspace != scenario.configspace:
        raise ValueError('SMAC checkpoint settings differ; refusing to overwrite or restart the saved run')
    saved = json.loads(path.read_text())
    if saved['output_directory'] != str(directory):
        saved['output_directory'] = str(directory)
        temporary = path.with_suffix('.resume-tmp')
        temporary.write_text(json.dumps(saved, indent=4))
        os.replace(temporary, path)
