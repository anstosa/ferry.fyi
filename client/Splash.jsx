import _ from 'lodash';
import clsx from 'clsx';
import React, {Component} from 'react';

export default class Splash extends Component {
    state = {
        isHelpVisible: false,
        mark: 0,
    };

    componentDidMount() {
        this.tickTimer = setInterval(this.tick, 600);
        this.helpTimer = setTimeout(this.showHelp, 10 * 1000);
    }

    componentWillUnmount() {
        clearInterval(this.tickTimer);
        clearTimeout(this.helpTimer);
    }

    tick = () => {
        let {mark} = this.state;
        mark++;
        if (mark === 3) {
            mark = 0;
        }
        this.setState({mark});
    };

    showHelp = () => {
        this.setState({isHelpVisible: true});
    };

    renderHelp = () => {
        const {isHelpVisible} = this.state;
        if (isHelpVisible) {
            return (
                <div
                    className="
                        fixed inset-x-0 bottom-0 w-full h-20
                        flex justify-center items-center
                    "
                >
                    Not working? Email{' '}
                    <a
                        className="link"
                        href="mailto:dev@ferry.fyi"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        dev@ferry.fyi
                    </a>
                    .
                </div>
            );
        } else {
            return null;
        }
    };

    render = () => {
        const {mark} = this.state;
        return (
            <div
                className="
                bg-green-dark text-white
                fixed inset-0
                flex flex-col justify-center items-center
            "
            >
                <i className="fas fa-3x fa-ship" />
                <div className="w-12 flex justify-between mt-8">
                    {_.times(3, (index) => (
                        <i
                            key={index}
                            className={clsx(
                                'fas fa-xs fa-circle',
                                mark === index ? 'visible' : 'invisible'
                            )}
                        />
                    ))}
                </div>
                {this.renderHelp()}
            </div>
        );
    };
}
